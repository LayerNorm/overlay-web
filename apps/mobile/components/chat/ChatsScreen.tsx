import React, { useMemo, useState } from 'react'
import { ActivityIndicator, Alert, Pressable, ScrollView, View } from 'react-native'
import Animated, { FadeIn } from 'react-native-reanimated'
import { Image } from 'expo-image'
import { Stack, useRouter } from 'expo-router'
import { useTheme } from '../../hooks/useTheme'
import { useWorkspace } from '../../contexts/WorkspaceContext'
import { useNativeDataReady } from '../../contexts/ConvexAuthProvider'
import { useLiveResource } from '../../hooks/useLiveResource'
import { api } from '../../services/convexClient'
import { useShellChats } from '../../hooks/useShellData'
import { useAgentDirectory, type DirectoryAgent } from '../../hooks/useAgentDirectory'
import { TabToolbar } from '../navigation/nativeHeader'
import { newChatRoute } from '../../lib/newChatRoute'
import { hapticSelect } from '../../lib/haptics'
import { getRequestWorkspaceId } from '../../services/appApi'
import { openAgentThread } from '../../services/shellService'
import type { SidebarChat } from '../shell/SidebarView'
import { AgentAvatar } from '../shell/AgentAvatar'
import { T } from '../shell/primitives'
import { RowMenu } from './ChatRowMenu'
import { RoomConfirmDialog, type RoomConfirmation } from './RoomSheets'
import { archiveConversation, deleteConversation, renameConversation } from '../../services/conversationActionsService'

type SectionId = 'agents' | 'channels' | 'dms' | 'chats'

/**
 * Chats home, laid out like a team inbox: shortcut cards on top, then
 * collapsible sections for agents, channels, direct messages and personal AI
 * chats. Unread conversations are bold with a count.
 */
export function ChatsScreen(): React.ReactElement {
  const { theme, isDark } = useTheme()
  const router = useRouter()
  const { activeWorkspaceId } = useWorkspace()
  const ready = useNativeDataReady()
  const [confirmation, setConfirmation] = useState<RoomConfirmation | null>(null)
  // Rows hidden right away after archive/delete, before the list subscription catches up.
  const [hidden, setHidden] = useState<string[]>([])
  const [collapsed, setCollapsed] = useState<Record<SectionId, boolean>>({
    agents: false,
    channels: false,
    dms: false,
    chats: false,
  })
  const [openError, setOpenError] = useState('')
  const personal = useShellChats(activeWorkspaceId, 'personal')
  const workspace = useShellChats(activeWorkspaceId, 'workspace')
  const directory = useAgentDirectory(activeWorkspaceId)
  const loading = personal.loading && workspace.loading
  const error = personal.error && workspace.error ? workspace.error : null

  const chats = useMemo(() => {
    const seen = new Set<string>()
    return [...workspace.chats, ...personal.chats].filter((chat) => {
      const key = `${chat.kind}:${chat.id}`
      if (hidden.includes(chat.id)) return false
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
  }, [personal.chats, workspace.chats, hidden])
  const channels = chats.filter((chat) => chat.kind === 'channel')
  const dms = chats.filter((chat) => chat.kind === 'dm')
  const personalChats = chats.filter((chat) => chat.kind === 'personal')
  const agents = directory.agents ?? []
  const activity = useLiveResource(
    api.collaboration.activity.notifications,
    ready && activeWorkspaceId ? { workspaceId: activeWorkspaceId } : null,
  )
  const unreadActivity = activity.data?.filter((item) => !item.readAt).length ?? 0

  const open = (chat: SidebarChat) =>
    router.push((chat.kind === 'personal' ? `/chat/${chat.id}` : `/${chat.kind}/${chat.id}`) as never)
  const newChat = () => router.push(newChatRoute() as never)
  const openAgent = (agent: DirectoryAgent) => {
    if (!activeWorkspaceId) return
    setOpenError('')
    void openAgentThread(activeWorkspaceId, agent.id)
      .then((result) => {
        if (result && getRequestWorkspaceId() === activeWorkspaceId)
          router.push(`/dm/${result.conversationId}` as never)
      })
      .catch((reason) => setOpenError(reason instanceof Error ? reason.message : String(reason)))
  }
  const newMessage = () => router.push('/new-message')
  const newChannel = () => router.push('/new-channel')
  const fail = (title: string, id?: string) => (reason: unknown) => {
    if (id) setHidden((ids) => ids.filter((value) => value !== id))
    Alert.alert(title, reason instanceof Error ? reason.message : 'Try again in a moment.')
  }
  const archive = (chat: SidebarChat) => {
    setHidden((ids) => [...ids, chat.id])
    void archiveConversation(chat.id).catch(fail('Could not archive the chat', chat.id))
  }
  const rename = (chat: SidebarChat) =>
    Alert.prompt('Rename chat', undefined, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Save',
        onPress: (value?: string) => {
          const title = value?.trim()
          if (title && title !== chat.title)
            void renameConversation(chat.id, title).catch(fail('Could not rename the chat'))
        },
      },
    ], 'plain-text', chat.title)
  const remove = (chat: SidebarChat) =>
    setConfirmation({
      title: `Delete “${chat.title || 'this chat'}”?`,
      message: 'This can’t be undone.',
      label: 'Delete chat',
      destructive: true,
      run: () => {
        setHidden((ids) => [...ids, chat.id])
        void deleteConversation(chat.id).catch(fail('Could not delete the chat', chat.id))
      },
    })
  const chatActions = (chat: SidebarChat) =>
    chat.kind === 'personal'
      ? [
          { label: 'Rename', icon: 'pencil', onPress: () => rename(chat) },
          { label: 'Archive', icon: 'archivebox', onPress: () => archive(chat) },
          { label: 'Delete', icon: 'trash', destructive: true, onPress: () => remove(chat) },
        ]
      : [{ label: 'Archive', icon: 'archivebox', onPress: () => archive(chat) }]
  const toggle = (id: SectionId) => {
    hapticSelect()
    setCollapsed((previous) => ({ ...previous, [id]: !previous[id] }))
  }

  return (
    <>
      <TabToolbar>
        <Stack.Toolbar.Menu icon="square.and.pencil" accessibilityLabel="New">
          <Stack.Toolbar.MenuAction icon="sparkles" onPress={newChat}>
            New chat
          </Stack.Toolbar.MenuAction>
          <Stack.Toolbar.MenuAction icon="person" onPress={newMessage}>
            New message
          </Stack.Toolbar.MenuAction>
          <Stack.Toolbar.MenuAction icon="number" onPress={newChannel}>
            New channel
          </Stack.Toolbar.MenuAction>
        </Stack.Toolbar.Menu>
      </TabToolbar>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        style={{ backgroundColor: theme.background }}
        contentContainerStyle={{ paddingBottom: 32 }}
      >
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 4, paddingBottom: 12, gap: 10 }}
        >
          <ShortcutCard symbol="sparkles" title="New chat" detail="Ask Overlay" onPress={newChat} />
          <ShortcutCard
            symbol="bell"
            title="Activity"
            detail={unreadActivity ? `${unreadActivity} unread` : 'All caught up'}
            onPress={() => router.push('/activity')}
          />
          <ShortcutCard symbol="clock.arrow.circlepath" title="Automations" detail="Scheduled" onPress={() => router.push('/automations')} />
          <ShortcutCard symbol="archivebox" title="Archived" detail="Past chats" onPress={() => router.push('/archived')} />
        </ScrollView>
        <View style={{ height: 0.5, backgroundColor: theme.border, marginBottom: 6 }} />

        {loading && !chats.length ? (
          <ActivityIndicator color={theme.muted} style={{ paddingTop: 48 }} />
        ) : error ? (
          <T selectable style={{ color: theme.muted, textAlign: 'center', padding: 40 }}>
            {error}
          </T>
        ) : (
          <>
            {openError ? (
              <T selectable accessibilityRole="alert" style={{ color: theme.foreground, paddingHorizontal: 20, paddingVertical: 8 }}>
                {openError}
              </T>
            ) : null}
            {directory.agents ? (
              <Section title="Agents" collapsed={collapsed.agents} onToggle={() => toggle('agents')}>
                {agents.map((agent) => (
                  <RowMenu
                    key={agent.id}
                    actions={[
                      { label: 'Open chat', icon: 'bubble.left', onPress: () => openAgent(agent) },
                      { label: 'Agent settings', icon: 'slider.horizontal.3', onPress: () => router.push({ pathname: '/agent/[id]', params: { id: agent.id } }) },
                    ]}
                  >
                    <Row
                      title={agent.name}
                      leading={<AgentAvatar agent={agent} dark={isDark} foreground={theme.foreground} size={26} />}
                      onPress={() => openAgent(agent)}
                    />
                  </RowMenu>
                ))}
                {directory.canCreate ? (
                  <AddRow label="Add agent" onPress={() => router.push('/agent-create')} />
                ) : null}
              </Section>
            ) : null}
            <Section
              title="Channels"
              collapsed={collapsed.channels}
              onToggle={() => toggle('channels')}
              onAdd={newChannel}
            >
              {channels.map((chat) => (
                <RowMenu key={chat.id} actions={chatActions(chat)}>
                  <ChatRow chat={chat} onPress={() => open(chat)} />
                </RowMenu>
              ))}
              <AddRow label="Add channel" onPress={newChannel} />
            </Section>
            <Section
              title="Direct messages"
              collapsed={collapsed.dms}
              onToggle={() => toggle('dms')}
              onAdd={newMessage}
            >
              {dms.map((chat) => (
                <RowMenu key={chat.id} actions={chatActions(chat)}>
                  <ChatRow chat={chat} onPress={() => open(chat)} />
                </RowMenu>
              ))}
              <AddRow label="New message" onPress={newMessage} />
            </Section>
            <Section title="Chats" collapsed={collapsed.chats} onToggle={() => toggle('chats')} onAdd={newChat}>
              {personalChats.map((chat) => (
                <RowMenu key={chat.id} actions={chatActions(chat)}>
                  <ChatRow chat={chat} onPress={() => open(chat)} />
                </RowMenu>
              ))}
              <AddRow label="New chat" onPress={newChat} />
            </Section>
          </>
        )}
      </ScrollView>
      <RoomConfirmDialog request={confirmation} onClose={() => setConfirmation(null)} />
    </>
  )
}

function ShortcutCard({
  symbol,
  title,
  detail,
  onPress,
}: {
  symbol: string
  title: string
  detail: string
  onPress: () => void
}) {
  const { theme } = useTheme()
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${title}, ${detail}`}
      onPress={onPress}
      style={({ pressed }) => ({
        width: 128,
        padding: 14,
        gap: 14,
        borderRadius: 18,
        borderCurve: 'continuous',
        borderWidth: 0.5,
        borderColor: theme.border,
        backgroundColor: pressed ? theme.surfaceMuted : theme.surfaceSubtle,
      })}
    >
      <Image source={`sf:${symbol}`} style={{ width: 22, height: 22 }} contentFit="contain" tintColor={theme.foreground as string} />
      <View style={{ gap: 2 }}>
        <T numberOfLines={1} style={{ color: theme.foreground, fontSize: 15, fontWeight: '600' }}>
          {title}
        </T>
        <T numberOfLines={1} style={{ color: theme.muted, fontSize: 13 }}>
          {detail}
        </T>
      </View>
    </Pressable>
  )
}

function Section({
  title,
  collapsed,
  onToggle,
  onAdd,
  children,
}: {
  title: string
  collapsed: boolean
  onToggle: () => void
  onAdd?: () => void
  children: React.ReactNode
}) {
  const { theme } = useTheme()
  return (
    <View style={{ paddingBottom: 6 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingLeft: 20, paddingRight: 10, height: 46 }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={title}
          accessibilityState={{ expanded: !collapsed }}
          onPress={onToggle}
          style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6, height: 46 }}
        >
          <T style={{ color: theme.foreground, fontSize: 17, fontWeight: '600', letterSpacing: -0.2 }}>{title}</T>
          <Image
            source={collapsed ? 'sf:chevron.right' : 'sf:chevron.down'}
            style={{ width: 11, height: 11 }}
            contentFit="contain"
            tintColor={theme.muted as string}
          />
        </Pressable>
        {onAdd ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Add to ${title}`}
            onPress={onAdd}
            hitSlop={6}
            style={({ pressed }) => ({
              width: 36,
              height: 36,
              borderRadius: 18,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: pressed ? theme.surfaceSubtle : 'transparent',
            })}
          >
            <Image source="sf:plus" style={{ width: 16, height: 16 }} contentFit="contain" tintColor={theme.muted as string} />
          </Pressable>
        ) : null}
      </View>
      {collapsed ? null : <Animated.View entering={FadeIn.duration(180)}>{children}</Animated.View>}
    </View>
  )
}

function Row({
  title,
  leading,
  unread = 0,
  muted = false,
  onPress,
}: {
  title: string
  leading: React.ReactNode
  unread?: number
  muted?: boolean
  onPress: () => void
}) {
  const { theme } = useTheme()
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${title}${unread ? `, ${unread} unread` : ''}`}
      onPress={onPress}
      style={({ pressed }) => ({
        height: 46,
        paddingHorizontal: 20,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 14,
        backgroundColor: pressed ? theme.surfaceSubtle : 'transparent',
      })}
    >
      <View style={{ width: 26, alignItems: 'center' }}>{leading}</View>
      <T
        numberOfLines={1}
        style={{
          flex: 1,
          fontSize: 17,
          color: muted ? theme.muted : theme.foreground,
          fontWeight: unread ? '600' : '400',
        }}
      >
        {title}
      </T>
      {unread ? (
        <View
          style={{
            minWidth: 22,
            height: 22,
            paddingHorizontal: 7,
            borderRadius: 11,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: theme.foreground,
          }}
        >
          <T style={{ fontSize: 12, fontWeight: '600', color: theme.background, fontVariant: ['tabular-nums'] }}>
            {unread > 99 ? '99+' : unread}
          </T>
        </View>
      ) : null}
    </Pressable>
  )
}

function ChatRow({ chat, onPress }: { chat: SidebarChat; onPress: () => void }) {
  const { theme } = useTheme()
  const unread = chat.unreadCount ?? (chat.unread ? 1 : 0)
  const title = chat.title || (chat.kind === 'channel' ? 'Untitled channel' : 'New chat')
  const leading =
    chat.kind === 'dm' ? (
      <View
        style={{
          width: 26,
          height: 26,
          borderRadius: 8,
          borderCurve: 'continuous',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: theme.surfaceMuted,
        }}
      >
        <T style={{ fontSize: 13, fontWeight: '600', color: theme.foreground }}>{title.trim()[0]?.toUpperCase() ?? '?'}</T>
      </View>
    ) : (
      <Image
        source={chat.kind === 'channel' ? 'sf:number' : 'sf:bubble.left'}
        style={{ width: 19, height: 19 }}
        contentFit="contain"
        tintColor={(unread ? theme.foreground : theme.muted) as string}
      />
    )
  return <Row title={title} leading={leading} unread={unread} onPress={onPress} />
}

function AddRow({ label, onPress }: { label: string; onPress: () => void }) {
  const { theme } = useTheme()
  return (
    <Row
      title={label}
      muted
      leading={<Image source="sf:plus" style={{ width: 17, height: 17 }} contentFit="contain" tintColor={theme.muted as string} />}
      onPress={onPress}
    />
  )
}
