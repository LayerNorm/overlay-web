import React, { useState } from 'react'
import { ActivityIndicator, Pressable, ScrollView, View } from 'react-native'
import {
  Activity,
  Bot,
  Check,
  ChevronDown,
  Folder,
  Hash,
  ListChecks,
  MessageCircleQuestion,
  MessageSquare,
  Plus,
  Puzzle,
  Search,
  Settings,
  Workflow,
  X,
} from 'lucide-react-native'
import type { Theme } from '../../constants/theme'
import {
  summarizeThreadActivity,
  type ThreadActivityStatus,
} from '../../../src/shared/agents/thread-activity'
import { AgentAvatar } from './AgentAvatar'
import { OverlayMark } from './Brand'
import { IconButton, T } from './primitives'

export type SidebarAgent = {
  id: string
  name: string
  isDefault?: boolean
  avatarColor?: string
  avatarShape?: string
  threads: Array<{ conversationId: string; title: string; status: ThreadActivityStatus }>
  loading?: boolean
}
export type SidebarChat = {
  id: string
  title: string
  kind: 'personal' | 'channel' | 'dm'
  unread?: boolean
  unreadCount?: number
}
const destinations = [
  { id: 'work', label: 'Work', icon: ListChecks },
  { id: 'agents', label: 'Agents', icon: Bot },
  { id: 'chat', label: 'Chats', icon: MessageSquare },
  { id: 'files', label: 'Files', icon: Folder },
  { id: 'automations', label: 'Automations', icon: Workflow },
]

export function SidebarView({
  theme,
  dark,
  panel,
  scope,
  onScope,
  agents,
  chats,
  loading,
  error,
  initials,
  extensions,
  onPanel,
  onClose,
  onAccount,
  onSearch,
  onAdd,
  onAgent,
  onThread,
  onChat,
}: {
  theme: Theme
  dark: boolean
  panel: 'agents' | 'chat'
  scope: 'personal' | 'workspace'
  onScope: (scope: 'personal' | 'workspace') => void
  agents: SidebarAgent[]
  chats: SidebarChat[]
  loading?: boolean
  error?: string | null
  initials: string
  extensions?: boolean
  onPanel: (id: string) => void
  onClose: () => void
  onAccount: () => void
  onSearch: () => void
  onAdd: () => void
  onAgent: (id: string, create?: boolean) => void
  onThread: (conversationId: string) => void
  onChat: (chat: SidebarChat) => void
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const row = { flexDirection: 'row', alignItems: 'center' } as const
  return (
    <View style={{ flex: 1, flexDirection: 'row', backgroundColor: theme.sidebarSurface }}>
      <View style={{ width: 60, alignItems: 'center', paddingTop: 8, paddingBottom: 5, gap: 10 }}>
        <View style={{ height: 34, justifyContent: 'center', marginBottom: 6 }}>
          <OverlayMark color={theme.foreground} size={24} />
        </View>
        {[
          ...destinations,
          ...(extensions ? [{ id: 'extensions', label: 'Extensions', icon: Puzzle }] : []),
        ].map((item) => (
          <IconButton
            key={item.id}
            theme={theme}
            icon={item.icon}
            label={item.label}
            onPress={() => onPanel(item.id)}
          />
        ))}
        <View style={{ flex: 1 }} />
        <IconButton
          theme={theme}
          icon={Activity}
          label="Activity"
          onPress={() => onPanel('activity')}
        />
        <IconButton
          theme={theme}
          icon={Settings}
          label="Settings"
          onPress={() => onPanel('settings')}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Workspace and account"
          onPress={onAccount}
          style={{
            width: 30,
            height: 30,
            borderRadius: 15,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: theme.buttonSecondaryBg,
          }}
        >
          <T style={{ color: theme.foreground, fontSize: 10 }}>{initials}</T>
        </Pressable>
      </View>
      <View style={{ flex: 1, paddingLeft: 12, paddingRight: 18 }}>
        <View style={[row, { height: 48, gap: 0, marginRight: -16 }]}>
          <T style={{ flex: 1, color: theme.foreground, fontSize: 20, letterSpacing: -0.5 }}>
            {panel === 'agents' ? 'Agents' : 'Chats'}
          </T>
          <IconButton theme={theme} icon={Search} label="Search" onPress={onSearch} />
          <IconButton
            theme={theme}
            icon={Plus}
            label={panel === 'agents' ? 'New agent' : 'New chat'}
            onPress={onAdd}
          />
          <IconButton
            theme={theme}
            icon={X}
            label="Close drawer"
            onPress={onClose}
            style={{ marginLeft: 9 }}
          />
        </View>
        <View style={[row, { gap: 0, marginBottom: 18, height: 34 }]}>
          {(['personal', 'workspace'] as const).map((value) => (
            <Pressable
              key={value}
              accessibilityRole="tab"
              accessibilityState={{ selected: scope === value }}
              onPress={() => onScope(value)}
              style={{
                flex: 1,
                borderRadius: 7,
                alignItems: 'center',
                justifyContent: 'center',
                height: 30,
                backgroundColor: scope === value ? theme.surfaceElevated : 'transparent',
              }}
            >
              <T style={{ color: scope === value ? theme.foreground : theme.muted, fontSize: 12 }}>
                {value === 'personal' ? 'Personal' : 'Workspace'}
              </T>
            </Pressable>
          ))}
        </View>
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: 24 }}
        >
          {loading ? (
            <ActivityIndicator color={theme.muted} style={{ marginTop: 22 }} />
          ) : error ? (
            <T accessibilityRole="alert" style={{ color: theme.muted, fontSize: 13, padding: 8 }}>
              {error}
            </T>
          ) : panel === 'agents' ? (
            agents.length ? (
              agents.map((agent) => {
                const counts = summarizeThreadActivity(
                  agent.threads.map((thread) => ({
                    conversationId: thread.conversationId,
                    status: thread.status,
                  })),
                )
                const summary =
                  counts.length === 1 && counts[0].status === 'needs_input' && counts[0].count === 1
                    ? 'Needs you'
                    : counts.map((item) => `${item.count} ${item.label}`).join(' · ')
                return (
                  <View key={agent.id} style={{ marginBottom: 6 }}>
                    <View style={[row, { gap: 8, minHeight: 56, paddingLeft: 4, paddingRight: 6 }]}>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`Open ${agent.name}`}
                        onPress={() => onAgent(agent.id)}
                        style={[row, { gap: 8, flex: 1 }]}
                      >
                        <AgentAvatar agent={agent} dark={dark} foreground={theme.foreground} />
                        <View style={{ flex: 1, gap: 5 }}>
                          <T numberOfLines={1} style={{ color: theme.foreground }}>
                            {agent.name}
                          </T>
                          {summary ? (
                            <T numberOfLines={1} style={{ fontSize: 11, color: theme.muted }}>
                              {summary}
                            </T>
                          ) : null}
                        </View>
                      </Pressable>
                      <IconButton
                        theme={theme}
                        icon={Plus}
                        label={`New ${agent.name} thread`}
                        onPress={() => onAgent(agent.id, true)}
                      />
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`${collapsed.has(agent.id) ? 'Expand' : 'Collapse'} ${agent.name}`}
                        accessibilityState={{ expanded: !collapsed.has(agent.id) }}
                        onPress={() =>
                          setCollapsed((current) => {
                            const next = new Set(current)
                            if (next.has(agent.id)) next.delete(agent.id)
                            else next.add(agent.id)
                            return next
                          })
                        }
                        hitSlop={8}
                      >
                        <ChevronDown
                          size={12}
                          color={theme.muted}
                          style={{
                            transform: [{ rotate: collapsed.has(agent.id) ? '-90deg' : '0deg' }],
                          }}
                        />
                      </Pressable>
                    </View>
                    {!collapsed.has(agent.id) ? (
                      agent.loading ? (
                        <ActivityIndicator color={theme.muted} size="small" />
                      ) : (
                        agent.threads.map((thread) => (
                          <Pressable
                            key={thread.conversationId}
                            accessibilityRole="button"
                            accessibilityLabel={`${thread.title}, ${thread.status.replace('_', ' ')}`}
                            onPress={() => onThread(thread.conversationId)}
                            style={[row, { height: 32, marginLeft: 34, gap: 8 }]}
                          >
                            <ThreadStatus theme={theme} dark={dark} status={thread.status} />
                            <T
                              numberOfLines={1}
                              style={{ flex: 1, color: theme.muted, fontSize: 13 }}
                            >
                              {thread.title}
                            </T>
                          </Pressable>
                        ))
                      )
                    ) : null}
                  </View>
                )
              })
            ) : (
              <T style={{ color: theme.muted, fontSize: 13, padding: 8 }}>
                No agents in this workspace.
              </T>
            )
          ) : (
            (['personal', 'channel', 'dm'] as const).map((kind) => {
              const items = chats.filter((chat) => chat.kind === kind)
              if (!items.length) return null
              return (
                <View key={kind} style={{ marginTop: 8, marginBottom: 12 }}>
                  <T style={{ fontSize: 12, color: theme.muted, marginBottom: 8 }}>
                    {kind === 'personal'
                      ? 'Personal chats'
                      : kind === 'channel'
                        ? 'Channels'
                        : 'Direct messages'}
                  </T>
                  {items.map((chat) => (
                    <Pressable
                      key={chat.id}
                      accessibilityRole="button"
                      onPress={() => onChat(chat)}
                      style={[row, { paddingVertical: 9, gap: 9 }]}
                    >
                      {kind === 'dm' ? (
                        <View
                          style={{
                            width: 20,
                            height: 20,
                            borderRadius: 10,
                            backgroundColor: theme.surfaceSubtle,
                            alignItems: 'center',
                            justifyContent: 'center',
                          }}
                        >
                          <T style={{ color: theme.foreground, fontSize: 9 }}>
                            {chat.title
                              .split(' ')
                              .map((part) => part[0])
                              .slice(0, 2)
                              .join('')}
                          </T>
                        </View>
                      ) : kind === 'channel' ? (
                        <Hash size={16} color={theme.muted} />
                      ) : (
                        <MessageSquare size={16} color={theme.muted} />
                      )}
                      <T numberOfLines={1} style={{ color: theme.muted, flex: 1, fontSize: 13 }}>
                        {chat.title}
                      </T>
                      {(chat.unreadCount ?? 0) > 0 ? (
                        <View
                          accessibilityLabel={`${chat.unreadCount} unread notifications`}
                          style={{
                            minWidth: 18,
                            height: 18,
                            borderRadius: 9,
                            paddingHorizontal: 5,
                            backgroundColor: theme.surfaceSubtle,
                            alignItems: 'center',
                            justifyContent: 'center',
                          }}
                        >
                          <T style={{ color: theme.muted, fontSize: 10 }}>
                            {Math.min(chat.unreadCount!, 99)}
                          </T>
                        </View>
                      ) : chat.unread ? (
                        <View
                          accessibilityLabel="Unread"
                          style={{
                            width: 6,
                            height: 6,
                            borderRadius: 3,
                            backgroundColor: theme.foreground,
                          }}
                        />
                      ) : null}
                    </Pressable>
                  ))}
                </View>
              )
            })
          )}
          {!loading && !error && panel === 'chat' && !chats.length ? (
            <T style={{ color: theme.muted, padding: 8, fontSize: 13 }}>No conversations yet.</T>
          ) : null}
        </ScrollView>
      </View>
    </View>
  )
}

function ThreadStatus({
  theme,
  dark,
  status,
}: {
  theme: Theme
  dark: boolean
  status: ThreadActivityStatus
}) {
  if (status === 'working') return <ActivityIndicator size={13} color={theme.muted} />
  if (status === 'needs_input' || status === 'failed' || status === 'cancelled')
    return <MessageCircleQuestion size={13} color={dark ? '#dfbc74' : '#a97926'} />
  if (status === 'idle') return <View style={{ width: 13 }} />
  return <Check size={13} color={status === 'ready' ? '#00b98a' : theme.muted} />
}
