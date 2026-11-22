import React, { useMemo, useState } from 'react'
import { ActivityIndicator, FlatList, Pressable, View } from 'react-native'
import { Image } from 'expo-image'
import { Stack, useRouter } from 'expo-router'
import { useTheme } from '../../hooks/useTheme'
import { useWorkspace } from '../../contexts/WorkspaceContext'
import { useShellChats } from '../../hooks/useShellData'
import { TabToolbar } from '../navigation/nativeHeader'
import { newChatRoute } from '../../lib/newChatRoute'
import { NativeSegmented } from '../navigation/NativeSegmented'
import type { SidebarChat } from '../shell/SidebarView'
import { T } from '../shell/primitives'
import { NewDirectMessageSheet } from './NewDirectMessageSheet'
import { NewChannelSheet } from './NewChannelSheet'

type Filter = 'all' | 'personal' | 'dm' | 'channel'

const FILTERS: ReadonlyArray<{ label: string; value: Filter }> = [
  { label: 'All', value: 'all' },
  { label: 'Chats', value: 'personal' },
  { label: 'DMs', value: 'dm' },
  { label: 'Channels', value: 'channel' },
]

const KIND_SYMBOL = {
  personal: 'sparkles',
  dm: 'person',
  channel: 'number',
} as const

export function ChatsScreen(): React.ReactElement {
  const { theme } = useTheme()
  const router = useRouter()
  const { activeWorkspaceId } = useWorkspace()
  const [filter, setFilter] = useState<Filter>('all')
  const [sheet, setSheet] = useState<'dm' | 'channel' | null>(null)
  // Personal-scope chats and workspace chats + rooms, merged like web's "All".
  const personal = useShellChats(activeWorkspaceId, 'personal')
  const workspace = useShellChats(activeWorkspaceId, 'workspace')
  const loading = personal.loading && workspace.loading
  const error = personal.error && workspace.error ? workspace.error : null
  const chats = useMemo(() => {
    const seen = new Set<string>()
    return [...workspace.chats, ...personal.chats].filter((chat) => {
      const key = `${chat.kind}:${chat.id}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
  }, [personal.chats, workspace.chats])

  const rows = useMemo(
    () => (filter === 'all' ? chats : chats.filter((chat) => chat.kind === filter)),
    [chats, filter],
  )

  const open = (chat: SidebarChat) =>
    router.push((chat.kind === 'personal' ? `/chat/${chat.id}` : `/${chat.kind}/${chat.id}`) as never)
  const newChat = () => router.push(newChatRoute() as never)

  return (
    <>
      <TabToolbar>
        <Stack.Toolbar.Button icon="archivebox" accessibilityLabel="Archived" onPress={() => router.push('/archived')} />
        <Stack.Toolbar.Menu icon="square.and.pencil" accessibilityLabel="New">
          <Stack.Toolbar.MenuAction icon="sparkles" onPress={newChat}>
            New chat
          </Stack.Toolbar.MenuAction>
          <Stack.Toolbar.MenuAction icon="person" onPress={() => setSheet('dm')}>
            New message
          </Stack.Toolbar.MenuAction>
          <Stack.Toolbar.MenuAction icon="number" onPress={() => setSheet('channel')}>
            New channel
          </Stack.Toolbar.MenuAction>
        </Stack.Toolbar.Menu>
      </TabToolbar>
      <FlatList
        data={rows}
        keyExtractor={(chat) => `${chat.kind}:${chat.id}`}
        contentInsetAdjustmentBehavior="automatic"
        style={{ backgroundColor: theme.background }}
        contentContainerStyle={{ paddingBottom: 24 }}
        ListHeaderComponent={
          <View style={{ paddingTop: 4, paddingBottom: 8 }}>
            <NativeSegmented value={filter} options={FILTERS} onChange={setFilter} />
          </View>
        }
        ListEmptyComponent={
          <View style={{ paddingTop: 64, alignItems: 'center', gap: 10, paddingHorizontal: 32 }}>
            {loading ? (
              <ActivityIndicator color={theme.muted} />
            ) : (
              <>
                <Image
                  source="sf:bubble.left.and.bubble.right"
                  style={{ width: 34, height: 34 }}
                  tintColor={theme.muted as string}
                />
                <T style={{ color: theme.foreground, fontSize: 17, fontWeight: '600' }}>
                  {error ? 'Couldn’t load chats' : 'No conversations'}
                </T>
                <T selectable style={{ color: theme.muted, textAlign: 'center' }}>
                  {error ?? 'Start a chat with Overlay, or message someone in your workspace.'}
                </T>
              </>
            )}
          </View>
        }
        ItemSeparatorComponent={() => (
          <View style={{ height: 0.5, marginLeft: 64, backgroundColor: theme.border }} />
        )}
        renderItem={({ item }) => <ChatRow chat={item} onPress={() => open(item)} />}
      />
      {activeWorkspaceId ? (
        <>
          <NewDirectMessageSheet
            visible={sheet === 'dm'}
            workspaceId={activeWorkspaceId}
            theme={theme}
            onClose={() => setSheet(null)}
            onCreated={(dm) => {
              setSheet(null)
              router.push(`/dm/${dm.id}` as never)
            }}
          />
          <NewChannelSheet
            visible={sheet === 'channel'}
            workspaceId={activeWorkspaceId}
            theme={theme}
            onClose={() => setSheet(null)}
            onCreated={(channel) => {
              setSheet(null)
              router.push(`/channel/${channel.id}` as never)
            }}
          />
        </>
      ) : null}
    </>
  )
}

function ChatRow({ chat, onPress }: { chat: SidebarChat; onPress: () => void }) {
  const { theme } = useTheme()
  const unread = chat.unreadCount ?? (chat.unread ? 1 : 0)
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${chat.title}${unread ? `, ${unread} unread` : ''}`}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: 60,
        paddingHorizontal: 16,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        backgroundColor: pressed ? theme.surfaceSubtle : 'transparent',
      })}
    >
      <View
        style={{
          width: 36,
          height: 36,
          borderRadius: 18,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: theme.surfaceSubtle,
        }}
      >
        <Image
          source={`sf:${KIND_SYMBOL[chat.kind]}`}
          style={{ width: 16, height: 16 }}
          tintColor={theme.foreground as string}
        />
      </View>
      <T
        numberOfLines={1}
        style={{
          flex: 1,
          fontSize: 16,
          color: theme.foreground,
          fontWeight: unread ? '600' : '400',
        }}
      >
        {chat.title || (chat.kind === 'channel' ? 'Untitled channel' : 'New chat')}
      </T>
      {unread ? (
        <View
          style={{
            minWidth: 20,
            height: 20,
            paddingHorizontal: 6,
            borderRadius: 10,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: theme.foreground,
          }}
        >
          <T style={{ fontSize: 12, fontWeight: '600', color: theme.background, fontVariant: ['tabular-nums'] }}>
            {unread > 99 ? '99+' : unread}
          </T>
        </View>
      ) : (
        <Image source="sf:chevron.right" style={{ width: 8, height: 13 }} tintColor={theme.mutedLight as string} />
      )}
    </Pressable>
  )
}
