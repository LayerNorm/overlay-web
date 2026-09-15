/**
 * Activity screen — native counterpart of web `ChatActivityView`: the
 * collaboration notification feed with All/Unread/Mentions/Threads/Reactions
 * filters, mark-all-read on open, per-notification routing into the right
 * conversation surface, and the notification-preferences sheet.
 */
import React, { useCallback, useMemo, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native'
import { useFocusEffect, useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Feather } from '@expo/vector-icons'
import type {
  WorkspaceNotification,
  WorkspaceNotificationFilter,
  WorkspaceNotificationPreferenceMode,
  WorkspaceNotificationPreferences,
} from '@overlay/workspace-contracts'
import { useTheme } from '../../hooks/useTheme'
import { useDrawer } from '../../contexts/DrawerContext'
import { useAppSession } from '../../contexts/AppSessionContext'
import { borderRadius, fontSize, spacing } from '../../constants/theme'
import {
  fetchNotificationPreferences,
  fetchNotifications,
  markNotificationsRead,
  updateNotificationPreferences,
} from '../../services/collaborationService'
import { openNotificationDestination } from '../../lib/notificationRouting'
import {
  BottomSheet,
  EmptyState,
  MainScreenHeader,
  SearchField,
  SegmentedControl,
  TopBarIconButton,
} from '../ui/AppChrome'
import { Section } from '../ui/primitives'
import { DrawerSidebar } from './DrawerSidebar'
import { ScreenWithDrawer } from '../ui/ScreenWithDrawer'
import { FeatureGate } from '../ui/FeatureGate'

const FILTERS: Array<{ value: WorkspaceNotificationFilter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'unread', label: 'Unread' },
  { value: 'mentions', label: 'Mentions' },
  { value: 'threads', label: 'Threads' },
  { value: 'reactions', label: 'Reactions' },
]

const EMPTY_STATES: Record<WorkspaceNotificationFilter, { title: string; description: string }> = {
  all: { title: 'No activity yet', description: 'You are all caught up.' },
  unread: { title: 'Nothing unread', description: 'New unread activity will appear here.' },
  mentions: { title: 'No mentions', description: 'Mentions from people and agents will appear here.' },
  threads: { title: 'No thread replies', description: 'Replies in threads you follow will appear here.' },
  reactions: { title: 'No reactions', description: 'Reactions to your messages will appear here.' },
}

function notificationIcon(type: WorkspaceNotification['type']): React.ComponentProps<typeof Feather>['name'] {
  if (type === 'mention') return 'at-sign'
  if (type === 'thread') return 'message-circle'
  if (type === 'reaction') return 'smile'
  return 'bell'
}

function conversationStateLabel(state?: 'archived' | 'deleted'): string | null {
  if (state === 'archived') return 'Archived'
  if (state === 'deleted') return 'Deleted'
  return null
}

function timeAgo(timestamp: number): string {
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000))
  if (seconds < 60) return 'now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d`
  return new Date(timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

const PREF_ROWS: Array<{ key: keyof WorkspaceNotificationPreferences; label: string; description: string }> = [
  { key: 'dmMessages', label: 'Direct messages', description: 'New DMs and group DMs' },
  { key: 'mentions', label: 'Mentions', description: 'When someone @mentions you' },
  { key: 'threadReplies', label: 'Thread replies', description: 'Replies in threads you follow' },
  { key: 'reactions', label: 'Reactions', description: 'Reactions to your messages' },
  { key: 'channelMessages', label: 'Channel messages', description: 'Activity in channels you joined' },
]

const PREF_MODES: Array<{ value: WorkspaceNotificationPreferenceMode; label: string }> = [
  { value: 'activity', label: 'Activity' },
  { value: 'banner', label: 'Banner' },
  { value: 'off', label: 'Off' },
]

export function ActivityScreen(): React.ReactElement {
  const { theme, isDark } = useTheme()
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const { openDrawer } = useDrawer()
  const { capabilities, isFeatureEnabled } = useAppSession()

  const [filter, setFilter] = useState<WorkspaceNotificationFilter>('all')
  const [sourceNotifications, setSourceNotifications] = useState<WorkspaceNotification[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [query, setQuery] = useState('')
  const [locallyRead, setLocallyRead] = useState<Map<string, number>>(() => new Map())
  const [prefsOpen, setPrefsOpen] = useState(false)
  const [preferences, setPreferences] = useState<WorkspaceNotificationPreferences | null>(null)
  const [prefsLoading, setPrefsLoading] = useState(false)

  const load = useCallback(async (mode: 'initial' | 'refresh' | 'poll' = 'initial') => {
    if (mode === 'refresh') setRefreshing(true)
    try {
      const items = await fetchNotifications('all', { limit: 100 })
      setSourceNotifications(items)
    } catch {
      // keep previous list on failure
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useFocusEffect(
    useCallback(() => {
      void load('initial')
      const interval = setInterval(() => void load('poll'), 15_000)
      return () => clearInterval(interval)
    }, [load]),
  )

  const notifications = useMemo(
    () =>
      sourceNotifications
        .filter((notification) => {
          if (filter === 'unread') return !notification.readAt && !locallyRead.has(notification.id)
          if (filter === 'mentions') return notification.type === 'mention'
          if (filter === 'threads') return notification.type === 'thread'
          if (filter === 'reactions') return notification.type === 'reaction'
          return true
        })
        .map((notification) =>
          locallyRead.has(notification.id)
            ? { ...notification, readAt: notification.readAt ?? locallyRead.get(notification.id) }
            : notification,
        )
        .filter(
          (notification) =>
            !query.trim() ||
            `${notification.title} ${notification.body ?? ''}`
              .toLowerCase()
              .includes(query.trim().toLowerCase()),
        ),
    [sourceNotifications, filter, locallyRead, query],
  )

  const unreadCount = sourceNotifications.filter(
    (notification) => !notification.readAt && !locallyRead.has(notification.id),
  ).length

  // Opening Activity marks everything read — same side effect as the web view.
  const markAllRead = useCallback(() => {
    const unreadIds = sourceNotifications
      .filter((notification) => !notification.readAt && !locallyRead.has(notification.id))
      .map(({ id }) => id)
    if (unreadIds.length === 0) return
    setLocallyRead((current) => {
      const next = new Map(current)
      const readAt = Date.now()
      for (const id of unreadIds) next.set(id, readAt)
      return next
    })
    void markNotificationsRead(unreadIds).catch(() => undefined)
  }, [sourceNotifications, locallyRead])

  useFocusEffect(
    useCallback(() => {
      markAllRead()
    }, [markAllRead]),
  )

  const openNotification = useCallback(
    async (notification: WorkspaceNotification) => {
      if (!notification.readAt && !locallyRead.has(notification.id)) {
        setLocallyRead((current) => new Map(current).set(notification.id, Date.now()))
        void markNotificationsRead([notification.id]).catch(() => undefined)
      }
      await openNotificationDestination(router, notification)
    },
    [router, locallyRead],
  )

  const openPreferences = useCallback(() => {
    setPrefsOpen(true)
    if (preferences) return
    setPrefsLoading(true)
    void fetchNotificationPreferences()
      .then((prefs) => setPreferences(prefs))
      .catch(() => undefined)
      .finally(() => setPrefsLoading(false))
  }, [preferences])

  const setPreferenceMode = useCallback(
    (key: keyof WorkspaceNotificationPreferences, mode: WorkspaceNotificationPreferenceMode) => {
      setPreferences((current) => (current ? { ...current, [key]: mode } : current))
      void updateNotificationPreferences({ [key]: mode }).catch(() => undefined)
    },
    [],
  )

  const enabled =
    capabilities.chat && (isFeatureEnabled('collaborativeChats') || isFeatureEnabled('channels'))
  if (!enabled) {
    return <FeatureGate title="Activity is turned off" />
  }

  const empty = EMPTY_STATES[filter]

  return (
    <ScreenWithDrawer
      drawer={
        <DrawerSidebar
          variant="slide"
          theme={theme}
          chats={[]}
          activeChatId={null}
          onSelectChat={(chatId) => router.push({ pathname: '/chat/[id]', params: { id: chatId } })}
          onCreateChat={() => router.push('/(tabs)/chat')}
        />
      }
    >
      <View style={[styles.screen, { backgroundColor: theme.background }]}>
        <MainScreenHeader
          theme={theme}
          isDark={isDark}
          topInset={insets.top}
          blurHeight={insets.top + 58}
          leftSlot={
            <TopBarIconButton theme={theme} icon="menu" onPress={openDrawer} />
          }
          centerSlot={
            <View style={styles.headerCenter}>
              <Text style={[styles.headerTitle, { color: theme.text }]}>Activity</Text>
              {unreadCount > 0 ? (
                <Text style={[styles.headerSubtitle, { color: theme.textSecondary }]}>
                  {unreadCount} unread
                </Text>
              ) : null}
            </View>
          }
          rightSlot={
            <View style={styles.headerActions}>
              <TopBarIconButton theme={theme} icon="check" onPress={markAllRead} />
              <TopBarIconButton theme={theme} icon="settings" onPress={openPreferences} />
            </View>
          }
        />

        <View style={[styles.filterRow, { paddingTop: insets.top + 62 }]}>
          <SegmentedControl
            theme={theme}
            value={filter}
            options={FILTERS}
            onChange={setFilter}
          />
        </View>
        <View style={styles.searchWrap}>
          <SearchField
            theme={theme}
            value={query}
            onChangeText={setQuery}
            placeholder="Search activity"
          />
        </View>

        {loading && notifications.length === 0 ? (
          <View style={styles.loadingWrap}>
            <ActivityIndicator color={theme.textSecondary} />
          </View>
        ) : notifications.length === 0 ? (
          <EmptyState
            theme={theme}
            icon="bell"
            title={empty.title}
            description={empty.description}
          />
        ) : (
          <ScrollView
            style={styles.list}
            contentContainerStyle={[styles.listContent, { paddingBottom: insets.bottom + spacing.xl }]}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={() => void load('refresh')}
                tintColor={theme.textSecondary}
              />
            }
          >
            <Section theme={theme}>
              {notifications.map((notification) => {
                const unread = !notification.readAt
                const stateLabel = conversationStateLabel(notification.conversationState)
                return (
                  <TouchableOpacity
                    key={notification.id}
                    activeOpacity={0.72}
                    onPress={() => void openNotification(notification)}
                    style={styles.notificationRow}
                  >
                    <View style={[styles.notificationIcon, { backgroundColor: theme.surfaceSubtle }]}>
                      <Feather
                        name={notificationIcon(notification.type)}
                        size={14}
                        color={theme.textSecondary}
                      />
                    </View>
                    <View style={styles.notificationBody}>
                      <Text
                        style={[
                          styles.notificationTitle,
                          { color: theme.text, fontWeight: unread ? '700' : '500' },
                        ]}
                        numberOfLines={2}
                      >
                        {notification.title}
                      </Text>
                      {notification.body ? (
                        <Text
                          style={[styles.notificationBodyText, { color: theme.textSecondary }]}
                          numberOfLines={2}
                        >
                          {notification.body}
                        </Text>
                      ) : null}
                      <Text style={[styles.notificationTime, { color: theme.textDisabled }]}>
                        {timeAgo(notification.createdAt)}
                        {stateLabel ? ` · ${stateLabel}` : ''}
                      </Text>
                    </View>
                    {unread ? (
                      <View style={[styles.unreadDot, { backgroundColor: theme.accent }]} />
                    ) : null}
                  </TouchableOpacity>
                )
              })}
            </Section>
          </ScrollView>
        )}

        {/* Notification preferences */}
        <BottomSheet
          theme={theme}
          visible={prefsOpen}
          onClose={() => setPrefsOpen(false)}
          title="Notification preferences"
        >
          {prefsLoading || !preferences ? (
            <View style={styles.loadingWrap}>
              <ActivityIndicator color={theme.textSecondary} />
            </View>
          ) : (
            PREF_ROWS.map((row) => (
              <View key={row.key} style={styles.prefRow}>
                <View style={styles.prefHeader}>
                  <Text style={[styles.prefLabel, { color: theme.text }]}>{row.label}</Text>
                  <Text style={[styles.prefDescription, { color: theme.textSecondary }]}>
                    {row.description}
                  </Text>
                </View>
                <SegmentedControl
                  theme={theme}
                  value={preferences[row.key]}
                  options={PREF_MODES}
                  onChange={(mode) => setPreferenceMode(row.key, mode)}
                />
              </View>
            ))
          )}
        </BottomSheet>
      </View>
    </ScreenWithDrawer>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  headerCenter: {
    alignItems: 'center',
    gap: 1,
  },
  headerTitle: {
    fontSize: fontSize.md,
    fontWeight: '700',
  },
  headerSubtitle: {
    fontSize: 11,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  filterRow: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
  },
  searchWrap: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
  },
  loadingWrap: {
    alignItems: 'center',
    paddingVertical: spacing.xl,
  },
  list: {
    flex: 1,
  },
  listContent: {
    paddingHorizontal: spacing.md,
  },
  notificationRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  notificationIcon: {
    width: 30,
    height: 30,
    borderRadius: 9,
    borderCurve: 'continuous',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  notificationBody: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  notificationTitle: {
    fontSize: fontSize.sm,
    lineHeight: 19,
  },
  notificationBodyText: {
    fontSize: fontSize.sm,
    lineHeight: 18,
  },
  notificationTime: {
    fontSize: 11,
    marginTop: 1,
  },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginTop: 6,
  },
  prefRow: {
    gap: spacing.xs,
  },
  prefHeader: {
    gap: 2,
  },
  prefLabel: {
    fontSize: fontSize.sm,
    fontWeight: '600',
  },
  prefDescription: {
    fontSize: fontSize.xs,
  },
})
