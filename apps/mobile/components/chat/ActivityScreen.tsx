import React, { useRef, useState } from 'react'
import { Alert, Pressable, ScrollView, View } from 'react-native'
import { Image } from 'expo-image'
import { Stack } from 'expo-router'
import * as Clipboard from 'expo-clipboard'
import * as WebBrowser from 'expo-web-browser'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import ReanimatedSwipeable, { type SwipeableMethods } from 'react-native-gesture-handler/ReanimatedSwipeable'
import type { WorkspaceNotification, WorkspaceNotificationFilter } from '@overlay/workspace-contracts'
import { api } from '../../services/convexClient'
import { useLiveResource } from '../../hooks/useLiveResource'
import { useTheme } from '../../hooks/useTheme'
import { filterNotifications, markNotificationsRead } from '../../services/collaborationService'
import { useWorkspace } from '../../contexts/WorkspaceContext'
import { openNotificationDestination } from '../../lib/notificationRouting'
import { activityPreview } from '../../lib/activity'
import { hapticImpact } from '../../lib/haptics'
import { AUTH_BASE_URL } from '../../services/appConfig'
import { getRequestWorkspaceId } from '../../services/appApi'
import { useResourceScope } from '../knowledge/ResourceScreens'
import { ResourceState } from '../knowledge/ResourceViews'
import { NativeSegmented } from '../navigation/NativeSegmented'
import { CreatureEmpty } from '../creatures/CreatureEmpty'
import { AgentAvatar } from '../shell/AgentAvatar'
import { T } from '../shell/primitives'
import { RowMenu } from './ChatRowMenu'

type Actor = { name: string; principalType?: string; isDefault?: boolean; avatarShape?: string; avatarColor?: string }

const FILTERS: Array<{ label: string; value: WorkspaceNotificationFilter }> = [
  { label: 'All', value: 'all' },
  { label: 'Unread', value: 'unread' },
  { label: 'Mentions', value: 'mentions' },
  { label: 'Threads', value: 'threads' },
  { label: 'Reactions', value: 'reactions' },
]

const TYPE_SYMBOL: Record<WorkspaceNotification['type'], string> = {
  message: 'bubble.left',
  mention: 'at',
  thread: 'arrowshape.turn.up.left',
  reaction: 'face.smiling',
  invitation: 'envelope',
  participant: 'person.badge.plus',
}

function dayLabel(time: number) {
  const day = new Date(time).setHours(0, 0, 0, 0)
  const today = new Date().setHours(0, 0, 0, 0)
  if (day === today) return 'Today'
  if (day === today - 86_400_000) return 'Yesterday'
  return new Date(time).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    ...(new Date(time).getFullYear() === new Date().getFullYear() ? {} : { year: 'numeric' }),
  })
}
const timeLabel = (time: number) => new Date(time).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })

export function ActivityScreen() {
  const { activeWorkspaceId } = useWorkspace()
  return <ActivityBody key={activeWorkspaceId} />
}

/**
 * Activity inbox. Items stay unread until you open them, swipe right on them
 * (Mark as Read), or choose Mark All as Read — the same model as Mail — so
 * the Unread filter and the unread dots mean something. Touch and hold a row
 * for Open, Mark as Read and Copy Text.
 */
function ActivityBody() {
  const { workspaceId, theme, router } = useResourceScope()
  const feed = useLiveResource(api.collaboration.activity.notifications, workspaceId ? { workspaceId } : null)
  const people = useLiveResource(api.collaboration.management.view, workspaceId ? { workspaceId, view: 'people' } : null)
  const agents = useLiveResource(api.collaboration.management.view, workspaceId ? { workspaceId, view: 'chats-agents' } : null)
  const actors: Record<string, Actor> = Object.fromEntries(
    [...(people.data?.items ?? []), ...(agents.data?.items ?? [])]
      .filter((item) => item.kind === 'member' && item.principalId)
      .map((item) => [item.principalId!, item as Actor]),
  )
  const [filter, setFilter] = useState<WorkspaceNotificationFilter>('all')
  // Marked read here before the live query catches up, so the dot clears at once.
  const [readIds, setReadIds] = useState<string[]>([])
  // The exact read time doesn't matter here, only that the item counts as read.
  const items = (feed.data ?? []).map((item) => (!item.readAt && readIds.includes(item.id) ? { ...item, readAt: item.createdAt } : item))
  const visible = filterNotifications(items, filter)
  const unread = items.filter((item) => !item.readAt)

  const markRead = (ids: string[]) => {
    const scope = workspaceId
    if (!scope || !ids.length || getRequestWorkspaceId() !== scope) return Promise.resolve()
    setReadIds((current) => [...current, ...ids])
    return markNotificationsRead(ids, scope).catch(() => {
      setReadIds((current) => current.filter((id) => !ids.includes(id)))
      if (getRequestWorkspaceId() === scope) Alert.alert('Could not mark as read', 'Check your connection and try again.')
    })
  }
  const open = (item: WorkspaceNotification) => {
    const scope = workspaceId
    void (item.readAt ? Promise.resolve() : markRead([item.id])).then(() => {
      if (getRequestWorkspaceId() === scope) void openNotificationDestination(router, item)
    })
  }
  const reportBug = () =>
    Alert.alert('Submit a bug', 'Bug reports and attachments are public on GitHub. Open Help → Submit a bug on web to send your report.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Open on Web', onPress: () => void WebBrowser.openBrowserAsync(AUTH_BASE_URL + '/home').catch(() => undefined) },
    ])

  const groups: Array<{ label: string; items: WorkspaceNotification[] }> = []
  for (const item of visible) {
    const label = dayLabel(item.createdAt)
    if (groups.at(-1)?.label === label) groups.at(-1)!.items.push(item)
    else groups.push({ label, items: [item] })
  }

  return (
    <>
      <Stack.Screen options={{ title: 'Activity' }} />
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Menu icon="ellipsis" accessibilityLabel="More">
          <Stack.Toolbar.MenuAction icon="envelope.open" disabled={!unread.length} onPress={() => void markRead(unread.map((item) => item.id))}>
            Mark All as Read
          </Stack.Toolbar.MenuAction>
          <Stack.Toolbar.MenuAction icon="ant" onPress={reportBug}>
            Submit a Bug
          </Stack.Toolbar.MenuAction>
        </Stack.Toolbar.Menu>
      </Stack.Toolbar>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        style={{ backgroundColor: theme.background }}
        contentContainerStyle={{ flexGrow: 1, paddingTop: 8, paddingBottom: 40 }}
      >
        <View style={{ paddingHorizontal: 16, paddingBottom: 4 }}>
          <NativeSegmented value={filter} options={FILTERS} onChange={setFilter} />
        </View>
        {!feed.data ? (
          <View style={{ paddingHorizontal: 20 }}>
            <ResourceState
              theme={theme}
              loading={feed.loading || !workspaceId}
              error={feed.error || (feed.data === null ? 'Activity is unavailable in this workspace.' : undefined)}
              onRetry={feed.retry}
            />
          </View>
        ) : !visible.length ? (
          <CreatureEmpty
            title={filter === 'unread' || (filter === 'all' && items.length) ? 'All caught up' : 'Nothing here yet'}
            detail="Mentions, replies and agent updates show up here."
            shape="blob"
            color="#8b5cf6"
          />
        ) : (
          groups.map((group) => (
            <View key={group.label}>
              <T style={{ color: theme.muted, fontSize: 13, fontWeight: '600', paddingHorizontal: 20, paddingTop: 20, paddingBottom: 6 }}>
                {group.label}
              </T>
              {group.items.map((item, index) => (
                <RowMenu
                  key={item.id}
                  actions={[
                    { label: 'Open', icon: 'arrow.up.right', onPress: () => open(item) },
                    ...(item.readAt ? [] : [{ label: 'Mark as Read', icon: 'envelope.open', onPress: () => void markRead([item.id]) }]),
                    {
                      label: 'Copy Text',
                      icon: 'doc.on.doc',
                      onPress: () => void Clipboard.setStringAsync(activityPreview(item.body ?? '') || item.title),
                    },
                  ]}
                >
                  <ActivityRow
                    item={item}
                    actor={actors[item.actorPrincipalId ?? '']}
                    separator={index < group.items.length - 1}
                    onOpen={() => open(item)}
                    onRead={() => void markRead([item.id])}
                  />
                </RowMenu>
              ))}
            </View>
          ))
        )}
      </ScrollView>
    </>
  )
}

function ActivityRow({
  item,
  actor,
  separator,
  onOpen,
  onRead,
}: {
  item: WorkspaceNotification
  actor?: Actor
  separator: boolean
  onOpen: () => void
  onRead: () => void
}) {
  const { theme, isDark } = useTheme()
  const swipe = useRef<SwipeableMethods>(null)
  const unread = !item.readAt
  const preview = activityPreview(item.body ?? '')
  const read = () => {
    hapticImpact()
    swipe.current?.close()
    onRead()
  }
  const leading = actor ? (
    actor.principalType === 'agent' ? (
      <AgentAvatar agent={actor} dark={isDark} foreground={theme.foreground as string} size={36} />
    ) : (
      <View style={{ width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.surfaceMuted }}>
        <T style={{ color: theme.foreground, fontSize: 14, fontWeight: '600' }}>
          {actor.name.split(' ').map((word) => word[0]).slice(0, 2).join('').toUpperCase()}
        </T>
      </View>
    )
  ) : (
    <View style={{ width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.surfaceMuted }}>
      <Image source={'sf:' + TYPE_SYMBOL[item.type]} style={{ width: 17, height: 17 }} contentFit="contain" tintColor={theme.muted as string} />
    </View>
  )
  return (
    <GestureHandlerRootView>
      <ReanimatedSwipeable
        ref={swipe}
        enabled={unread}
        friction={1.5}
        leftThreshold={72}
        overshootLeft={false}
        // Only the leading action exists, so a completed swipe always means Mark as Read.
        onSwipeableWillOpen={read}
        renderLeftActions={() => (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Mark as read"
            onPress={read}
            style={{ width: 88, alignItems: 'center', justifyContent: 'center', gap: 4, backgroundColor: theme.foreground }}
          >
            <Image source="sf:envelope.open.fill" style={{ width: 20, height: 20 }} contentFit="contain" tintColor={theme.background as string} />
            <T style={{ color: theme.background, fontSize: 12, fontWeight: '600' }}>Read</T>
          </Pressable>
        )}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={(unread ? 'Unread. ' : '') + item.title}
          accessibilityActions={unread ? [{ name: 'markRead', label: 'Mark as read' }] : undefined}
          onAccessibilityAction={(event) => {
            if (event.nativeEvent.actionName === 'markRead') onRead()
          }}
          onPress={onOpen}
          style={({ pressed }) => ({ flexDirection: 'row', backgroundColor: pressed ? theme.surfaceMuted : theme.background })}
        >
          <View style={{ width: 20, alignItems: 'center', paddingTop: 26 }}>
            {unread ? <View style={{ width: 9, height: 9, borderRadius: 4.5, backgroundColor: theme.foreground }} /> : null}
          </View>
          <View style={{ paddingTop: 12 }}>{leading}</View>
          <View
            style={{
              flex: 1,
              marginLeft: 12,
              paddingTop: 12,
              paddingBottom: 12,
              paddingRight: 16,
              gap: 2,
              borderBottomWidth: separator ? 0.5 : 0,
              borderBottomColor: theme.border,
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
              <T numberOfLines={1} style={{ flex: 1, color: theme.foreground, fontSize: 16, fontWeight: unread ? '600' : '400' }}>
                {item.title}
              </T>
              <T style={{ color: theme.muted, fontSize: 13, fontVariant: ['tabular-nums'] }}>{timeLabel(item.createdAt)}</T>
            </View>
            {preview ? (
              <T numberOfLines={2} style={{ color: theme.muted, fontSize: 15, lineHeight: 20 }}>
                {preview}
              </T>
            ) : null}
          </View>
        </Pressable>
      </ReanimatedSwipeable>
    </GestureHandlerRootView>
  )
}
