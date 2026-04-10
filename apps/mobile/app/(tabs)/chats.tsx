import React, { useCallback, useMemo, useState } from 'react'
import {
  Alert,
  SectionList,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Feather } from '@expo/vector-icons'
import { useFocusEffect, useRouter } from 'expo-router'
import * as Haptics from 'expo-haptics'
import { borderRadius, fontSize, spacing } from '../../constants/theme'
import { useTheme } from '../../hooks/useTheme'
import { ChatMeta } from '../../services/chatTypes'
import { deleteChat, loadChatsMeta } from '../../services/chatStorage'
import { formatDate } from '../../services/types'
import {
  IconAction,
  MetricTile,
  PanelCard,
  SectionLabel
} from '../../components/ui/PanelPrimitives'

function withOpacity(color: string, opacity: number): string {
  if (!color.startsWith('#')) return color

  const hex = color.slice(1)
  const normalized =
    hex.length === 3
      ? hex
          .split('')
          .map((char) => char + char)
          .join('')
      : hex

  const value = Number.parseInt(normalized, 16)
  const red = (value >> 16) & 255
  const green = (value >> 8) & 255
  const blue = value & 255

  return `rgba(${red}, ${green}, ${blue}, ${opacity})`
}

function getDateBucket(timestamp: number): string {
  const date = new Date(timestamp)
  const today = new Date()
  const yesterday = new Date(today)
  yesterday.setDate(yesterday.getDate() - 1)

  if (date.toDateString() === today.toDateString()) return 'Today'
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday'
  return date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
}

function getTimeLabel(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit'
  })
}

function getFreshnessLabel(timestamp: number): string {
  const diffHours = Math.floor((Date.now() - timestamp) / (1000 * 60 * 60))

  if (diffHours <= 1) return 'Fresh'
  if (diffHours < 12) return `${diffHours}h ago`
  if (diffHours < 24) return 'Today'

  const diffDays = Math.floor(diffHours / 24)
  if (diffDays < 7) return `${diffDays}d ago`
  return 'Archive'
}

function getAccent(seed: string, isDark: boolean): {
  tint: string
  wash: string
  line: string
} {
  const accents = isDark
    ? [
        { tint: '#7dd3fc', wash: 'rgba(125, 211, 252, 0.16)', line: 'rgba(125, 211, 252, 0.42)' },
        { tint: '#c4b5fd', wash: 'rgba(196, 181, 253, 0.16)', line: 'rgba(196, 181, 253, 0.42)' },
        { tint: '#fda4af', wash: 'rgba(253, 164, 175, 0.16)', line: 'rgba(253, 164, 175, 0.42)' },
        { tint: '#86efac', wash: 'rgba(134, 239, 172, 0.16)', line: 'rgba(134, 239, 172, 0.42)' }
      ]
    : [
        { tint: '#0f766e', wash: 'rgba(15, 118, 110, 0.10)', line: 'rgba(15, 118, 110, 0.22)' },
        { tint: '#4338ca', wash: 'rgba(67, 56, 202, 0.10)', line: 'rgba(67, 56, 202, 0.22)' },
        { tint: '#b45309', wash: 'rgba(180, 83, 9, 0.10)', line: 'rgba(180, 83, 9, 0.22)' },
        { tint: '#be123c', wash: 'rgba(190, 18, 60, 0.10)', line: 'rgba(190, 18, 60, 0.22)' }
      ]

  const hash = seed.split('').reduce((sum, char) => sum + char.charCodeAt(0), 0)
  return accents[hash % accents.length]
}

function ChatListRow({
  chat,
  isDark,
  onPress,
  onDelete
}: {
  chat: ChatMeta
  isDark: boolean
  onPress: () => void
  onDelete: () => void
}): React.ReactElement {
  const { theme } = useTheme()
  const accent = getAccent(chat.id, isDark)

  return (
    <TouchableOpacity
      onPress={onPress}
      onLongPress={onDelete}
      activeOpacity={0.86}
      style={[styles.chatRow, { borderBottomColor: theme.border }]}
    >
      <View style={[styles.rowRail, { backgroundColor: accent.tint }]} />

      <View style={[styles.rowIconWrap, { backgroundColor: accent.wash, borderColor: accent.line }]}>
        <Feather name="message-square" size={16} color={accent.tint} />
      </View>

      <View style={styles.rowBody}>
        <View style={styles.rowTitleLine}>
          <Text style={[styles.rowTitle, { color: theme.text }]} numberOfLines={1}>
            {chat.title || 'New Chat'}
          </Text>

          <View style={[styles.rowBadge, { backgroundColor: withOpacity(theme.text, isDark ? 0.12 : 0.05) }]}>
            <Text style={[styles.rowBadgeText, { color: theme.textSecondary }]}>
              {getFreshnessLabel(chat.updatedAt)}
            </Text>
          </View>
        </View>

        <Text style={[styles.rowPreview, { color: theme.textSecondary }]} numberOfLines={2}>
          {chat.lastMessage || 'Open the thread to continue the conversation.'}
        </Text>

        <View style={styles.rowFooter}>
          <View style={[styles.footerPill, { backgroundColor: accent.wash, borderColor: accent.line }]}>
            <Text style={[styles.footerPillText, { color: accent.tint }]}>{getDateBucket(chat.updatedAt)}</Text>
          </View>
          <Text style={[styles.rowDate, { color: theme.textDisabled }]}>{getTimeLabel(chat.updatedAt)}</Text>
        </View>
      </View>

      <Feather name="chevron-right" size={18} color={theme.textDisabled} />
    </TouchableOpacity>
  )
}

export default function ChatsScreen(): React.ReactElement {
  const router = useRouter()
  const { theme, isDark } = useTheme()

  const [chats, setChats] = useState<ChatMeta[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [showSearch, setShowSearch] = useState(false)

  const refreshChats = useCallback(async () => {
    setChats(await loadChatsMeta())
  }, [])

  useFocusEffect(
    useCallback(() => {
      void refreshChats()
    }, [refreshChats])
  )

  const handleDelete = useCallback(
    (chat: ChatMeta) => {
      Alert.alert('Delete chat', `Delete "${chat.title}"?`, [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            await deleteChat(chat.id)
            void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
            await refreshChats()
          }
        }
      ])
    },
    [refreshChats]
  )

  const filteredChats = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    if (!query) return chats

    return chats.filter(
      (chat) =>
        chat.title.toLowerCase().includes(query) ||
        chat.lastMessage?.toLowerCase().includes(query)
    )
  }, [chats, searchQuery])

  const sections = useMemo(() => {
    const groups: Record<string, ChatMeta[]> = {}

    for (const chat of filteredChats) {
      const bucket = getDateBucket(chat.updatedAt)
      if (!groups[bucket]) groups[bucket] = []
      groups[bucket].push(chat)
    }

    return Object.entries(groups).map(([title, data]) => ({ title, data }))
  }, [filteredChats])

  const latestPreview = chats[0]
  const activeTodayCount = chats.filter((chat) => getDateBucket(chat.updatedAt) === 'Today').length
  const activeThisWeekCount = chats.filter((chat) => Date.now() - chat.updatedAt < 7 * 24 * 60 * 60 * 1000).length

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]}>
      <View pointerEvents="none" style={StyleSheet.absoluteFill}>
        <View
          style={[
            styles.backgroundOrb,
            styles.backgroundOrbPrimary,
            { backgroundColor: isDark ? 'rgba(125, 211, 252, 0.12)' : 'rgba(59, 130, 246, 0.10)' }
          ]}
        />
        <View
          style={[
            styles.backgroundOrb,
            styles.backgroundOrbSecondary,
            { backgroundColor: isDark ? 'rgba(253, 164, 175, 0.09)' : 'rgba(245, 158, 11, 0.10)' }
          ]}
        />
      </View>

      <SectionList
        sections={sections}
        keyExtractor={(item) => item.id}
        stickySectionHeadersEnabled={false}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.content}
        ListHeaderComponent={
          <View style={styles.headerStack}>
            <View style={styles.topBar}>
              <View style={styles.titleBlock}>
                <Text style={[styles.eyebrow, { color: theme.textSecondary }]}>Signal Deck</Text>
                <Text style={[styles.title, { color: theme.text }]}>Chats</Text>
                <Text style={[styles.subtitle, { color: theme.textSecondary }]}>
                  Keep fast-moving conversations visible, searchable, and easy to resume.
                </Text>
              </View>

              <View style={styles.topBarActions}>
                <IconAction
                  theme={theme}
                  icon={showSearch ? 'x' : 'search'}
                  onPress={() => setShowSearch((value) => !value)}
                  active={showSearch}
                />
                <TouchableOpacity
                  onPress={() => router.push('/chat/new')}
                  activeOpacity={0.86}
                  style={[styles.primaryFab, { backgroundColor: theme.buttonBg }]}
                >
                  <Feather name="plus" size={18} color={theme.surface} />
                </TouchableOpacity>
              </View>
            </View>

            <PanelCard theme={theme}>
              <View
                style={[
                  styles.heroCard,
                  {
                    backgroundColor: isDark ? withOpacity('#7dd3fc', 0.08) : withOpacity('#eff6ff', 0.92),
                    borderColor: withOpacity(theme.text, isDark ? 0.18 : 0.06)
                  }
                ]}
              >
                <View style={styles.heroTopRow}>
                  <View style={styles.heroCopy}>
                    <View
                      style={[
                        styles.heroChip,
                        { backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.7)' }
                      ]}
                    >
                      <Feather name="radio" size={13} color={theme.textSecondary} />
                      <Text style={[styles.heroChipText, { color: theme.textSecondary }]}>
                        {latestPreview ? 'Ready to continue' : 'Waiting for first thread'}
                      </Text>
                    </View>

                    <Text style={[styles.heroTitle, { color: theme.text }]}>Your conversation workspace</Text>
                    <Text style={[styles.heroDescription, { color: theme.textSecondary }]}>
                      Re-enter active threads in one tap, keep recent context in view, and cut straight to the next prompt.
                    </Text>
                  </View>

                  <TouchableOpacity
                    onPress={() => (latestPreview ? router.push(`/chat/${latestPreview.id}`) : router.push('/chat/new'))}
                    activeOpacity={0.86}
                    style={[styles.heroCta, { backgroundColor: theme.buttonBg }]}
                  >
                    <Text style={[styles.heroCtaText, { color: theme.surface }]}>
                      {latestPreview ? 'Resume latest' : 'Start chat'}
                    </Text>
                    <Feather name="arrow-up-right" size={16} color={theme.surface} />
                  </TouchableOpacity>
                </View>

                <View style={styles.metricRow}>
                  <MetricTile theme={theme} label="Threads" value={String(chats.length)} />
                  <MetricTile theme={theme} label="Today" value={String(activeTodayCount)} />
                  <MetricTile theme={theme} label="Week" value={String(activeThisWeekCount)} />
                </View>

                {latestPreview ? (
                  <TouchableOpacity
                    onPress={() => router.push(`/chat/${latestPreview.id}`)}
                    activeOpacity={0.86}
                    style={[
                      styles.resumeCard,
                      {
                        backgroundColor: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(255,255,255,0.72)',
                        borderColor: withOpacity(theme.text, isDark ? 0.16 : 0.08)
                      }
                    ]}
                  >
                    <View style={[styles.resumeIconWrap, { backgroundColor: withOpacity(theme.text, isDark ? 0.12 : 0.05) }]}>
                      <Feather name="corner-down-right" size={16} color={theme.textSecondary} />
                    </View>

                    <View style={styles.resumeCopy}>
                      <Text style={[styles.resumeLabel, { color: theme.textSecondary }]}>Last thread</Text>
                      <Text style={[styles.resumeTitle, { color: theme.text }]} numberOfLines={1}>
                        {latestPreview.title}
                      </Text>
                      <Text style={[styles.resumePreview, { color: theme.textSecondary }]} numberOfLines={2}>
                        {latestPreview.lastMessage || 'Open the conversation to continue where you left off.'}
                      </Text>
                    </View>

                    <View style={styles.resumeMetaWrap}>
                      <Text style={[styles.resumeMeta, { color: theme.textDisabled }]}>
                        {formatDate(latestPreview.updatedAt)}
                      </Text>
                    </View>
                  </TouchableOpacity>
                ) : null}
              </View>
            </PanelCard>

            {showSearch ? (
              <PanelCard theme={theme} padded={false}>
                <View
                  style={[
                    styles.searchRow,
                    { backgroundColor: isDark ? 'rgba(255,255,255,0.02)' : 'rgba(255,255,255,0.5)' }
                  ]}
                >
                  <View style={[styles.searchIconWrap, { backgroundColor: withOpacity(theme.text, isDark ? 0.12 : 0.05) }]}>
                    <Feather name="search" size={16} color={theme.textSecondary} />
                  </View>
                  <TextInput
                    value={searchQuery}
                    onChangeText={setSearchQuery}
                    placeholder="Search by title or message preview"
                    placeholderTextColor={theme.textDisabled}
                    style={[styles.searchInput, { color: theme.text }]}
                    autoFocus
                  />
                  {searchQuery ? (
                    <Text style={[styles.searchCount, { color: theme.textSecondary }]}>
                      {filteredChats.length}
                    </Text>
                  ) : null}
                </View>
              </PanelCard>
            ) : null}

            {filteredChats.length === 0 ? (
              <PanelCard theme={theme}>
                <View style={styles.emptyState}>
                  <View style={[styles.emptyIcon, { backgroundColor: withOpacity(theme.text, isDark ? 0.10 : 0.05), borderColor: theme.border }]}>
                    <Feather name="message-circle" size={28} color={theme.textSecondary} />
                  </View>
                  <Text style={[styles.emptyTitle, { color: theme.text }]}>
                    {chats.length === 0 ? 'No conversations yet' : 'Nothing matches this search'}
                  </Text>
                  <Text style={[styles.emptyDescription, { color: theme.textSecondary }]}>
                    {chats.length === 0
                      ? 'Start a new conversation and the workspace will begin to fill out here.'
                      : 'Try a broader term, or open the latest thread from the hero card above.'}
                  </Text>
                </View>
              </PanelCard>
            ) : null}
          </View>
        }
        renderSectionHeader={({ section }) =>
          section.data.length > 0 ? (
            <View style={styles.sectionHeader}>
              <SectionLabel theme={theme}>{section.title}</SectionLabel>
            </View>
          ) : null
        }
        renderItem={({ item, index, section }) => (
          <PanelCard theme={theme} padded={false}>
            <ChatListRow
              chat={item}
              isDark={isDark}
              onPress={() => router.push(`/chat/${item.id}`)}
              onDelete={() => handleDelete(item)}
            />
            {index === section.data.length - 1 ? <View style={styles.lastRowSpacer} /> : null}
          </PanelCard>
        )}
        SectionSeparatorComponent={() => <View style={{ height: spacing.lg }} />}
      />
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1
  },
  content: {
    paddingHorizontal: spacing.xl,
    paddingBottom: 140
  },
  backgroundOrb: {
    position: 'absolute',
    width: 240,
    height: 240,
    borderRadius: 240
  },
  backgroundOrbPrimary: {
    top: -32,
    right: -72
  },
  backgroundOrbSecondary: {
    top: 230,
    left: -96
  },
  headerStack: {
    gap: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.lg
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.md
  },
  titleBlock: {
    flex: 1,
    gap: 4
  },
  topBarActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm
  },
  eyebrow: {
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.8
  },
  title: {
    fontFamily: 'InstrumentSerif-Regular',
    fontSize: 42,
    lineHeight: 44
  },
  subtitle: {
    maxWidth: 250,
    fontSize: fontSize.sm,
    lineHeight: 20
  },
  primaryFab: {
    width: 44,
    height: 44,
    borderRadius: borderRadius.full,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000000',
    shadowOpacity: 0.12,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 }
  },
  heroCard: {
    borderWidth: 1,
    borderRadius: 26,
    padding: spacing.lg,
    gap: spacing.md
  },
  heroTopRow: {
    gap: spacing.md
  },
  heroCopy: {
    gap: 10
  },
  heroChip: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: borderRadius.full,
    paddingHorizontal: 12,
    paddingVertical: 8
  },
  heroChipText: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.3
  },
  heroTitle: {
    fontFamily: 'InstrumentSerif-Regular',
    fontSize: 30,
    lineHeight: 32
  },
  heroDescription: {
    fontSize: fontSize.sm,
    lineHeight: 21
  },
  heroCta: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: borderRadius.full,
    paddingHorizontal: 16,
    paddingVertical: 12
  },
  heroCtaText: {
    fontSize: fontSize.md,
    fontWeight: '700'
  },
  metricRow: {
    flexDirection: 'row',
    gap: spacing.sm
  },
  resumeCard: {
    borderWidth: 1,
    borderRadius: 22,
    padding: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md
  },
  resumeIconWrap: {
    width: 42,
    height: 42,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center'
  },
  resumeCopy: {
    flex: 1,
    gap: 3
  },
  resumeLabel: {
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.6
  },
  resumeTitle: {
    fontSize: fontSize.lg,
    fontWeight: '700'
  },
  resumePreview: {
    fontSize: fontSize.sm,
    lineHeight: 19
  },
  resumeMetaWrap: {
    alignSelf: 'flex-start',
    paddingTop: 2
  },
  resumeMeta: {
    fontSize: 12,
    fontWeight: '600'
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md
  },
  searchIconWrap: {
    width: 34,
    height: 34,
    borderRadius: borderRadius.full,
    alignItems: 'center',
    justifyContent: 'center'
  },
  searchInput: {
    flex: 1,
    fontSize: fontSize.md
  },
  searchCount: {
    fontSize: 12,
    fontWeight: '700'
  },
  emptyState: {
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.xl
  },
  emptyIcon: {
    width: 76,
    height: 76,
    borderRadius: 38,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center'
  },
  emptyTitle: {
    fontSize: fontSize.xl,
    fontWeight: '700'
  },
  emptyDescription: {
    maxWidth: 280,
    fontSize: fontSize.sm,
    textAlign: 'center',
    lineHeight: 20
  },
  sectionHeader: {
    paddingBottom: spacing.sm
  },
  chatRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1
  },
  rowRail: {
    width: 4,
    alignSelf: 'stretch',
    borderRadius: borderRadius.full
  },
  rowIconWrap: {
    width: 42,
    height: 42,
    borderRadius: 16,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center'
  },
  rowBody: {
    flex: 1,
    gap: 7
  },
  rowTitleLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm
  },
  rowTitle: {
    flex: 1,
    fontSize: 15,
    fontWeight: '700'
  },
  rowBadge: {
    borderRadius: borderRadius.full,
    paddingHorizontal: 10,
    paddingVertical: 5
  },
  rowBadgeText: {
    fontSize: 11,
    fontWeight: '700'
  },
  rowPreview: {
    fontSize: fontSize.sm,
    lineHeight: 19
  },
  rowFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm
  },
  footerPill: {
    borderWidth: 1,
    borderRadius: borderRadius.full,
    paddingHorizontal: 10,
    paddingVertical: 5
  },
  footerPillText: {
    fontSize: 11,
    fontWeight: '700'
  },
  rowDate: {
    fontSize: 12,
    fontWeight: '600'
  },
  lastRowSpacer: {
    height: 6
  }
})
