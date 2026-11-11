import AsyncStorage from '@react-native-async-storage/async-storage'
import { api, convexWorkspaceId, mutateConvex, queryConvex, subscribeConvex, type Id } from './convexClient'
import { appRequest } from './appApi'
import type { FunctionReturnType } from 'convex/server'
import { projectActivePublicStreams, type ActivePublicStreamSnapshot } from '../../src/shared/chat/public-stream-projection'
import { queryAllPages, subscribeAllPages } from './convexPagination'
import { mapNativePersonalMessageRows } from '../lib/toNativeChatMessage'
import {
  generateChatId,
  type Chat,
  type ChatMeta,
  type Message,
} from './chatTypes'

const LAST_CHAT_ID_KEY = 'overlay-last-chat-id'
const SNAPSHOT_PREFIX = 'overlay-chat-snapshot:'
const SNAPSHOT_INDEX_KEY = 'overlay-chat-snapshot-index'
const MAX_SNAPSHOTS = 20
const MAX_SNAPSHOT_BYTES = 900 * 1024

interface ChatSnapshot {
  savedAt: number
  chat: Chat
}

/**
 * Read-through snapshot cache: keeps the last N opened conversations readable
 * offline. Snapshots store the already-mapped `Chat` (render model survives a
 * round trip) and are evicted LRU-style beyond `MAX_SNAPSHOTS`; oversized
 * transcripts are skipped so AsyncStorage stays bounded.
 */
export async function saveChatSnapshot(chat: Chat): Promise<void> {
  try {
    const payload = JSON.stringify({ savedAt: Date.now(), chat } satisfies ChatSnapshot)
    if (payload.length > MAX_SNAPSHOT_BYTES) return
    await AsyncStorage.setItem(`${SNAPSHOT_PREFIX}${chat.id}`, payload)
    const rawIndex = await AsyncStorage.getItem(SNAPSHOT_INDEX_KEY)
    const index: string[] = rawIndex ? (JSON.parse(rawIndex) as string[]) : []
    const next = [chat.id, ...index.filter((entry) => entry !== chat.id)]
    const evicted = next.slice(MAX_SNAPSHOTS)
    await AsyncStorage.setItem(SNAPSHOT_INDEX_KEY, JSON.stringify(next.slice(0, MAX_SNAPSHOTS)))
    for (const evictedId of evicted) {
      await AsyncStorage.removeItem(`${SNAPSHOT_PREFIX}${evictedId}`)
    }
  } catch {
    // Snapshot writes are best-effort — never break a chat load.
  }
}

export async function loadChatSnapshot(id: string): Promise<Chat | null> {
  try {
    const raw = await AsyncStorage.getItem(`${SNAPSHOT_PREFIX}${id}`)
    if (!raw) return null
    const snapshot = JSON.parse(raw) as ChatSnapshot
    if (!snapshot.chat || snapshot.chat.id !== id || !Array.isArray(snapshot.chat.messages)) {
      return null
    }
    return { ...snapshot.chat, restoredFromCache: true }
  } catch {
    return null
  }
}

async function removeChatSnapshot(id: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(`${SNAPSHOT_PREFIX}${id}`)
    const rawIndex = await AsyncStorage.getItem(SNAPSHOT_INDEX_KEY)
    if (rawIndex) {
      const index = (JSON.parse(rawIndex) as string[]).filter((entry) => entry !== id)
      await AsyncStorage.setItem(SNAPSHOT_INDEX_KEY, JSON.stringify(index))
    }
  } catch {
    // best-effort
  }
}

type NativeSummary = NonNullable<FunctionReturnType<typeof api.chat.personal.getSummary>>
function personalArgs(id: string) { return { workspaceId: convexWorkspaceId(), conversationId: id as Id<'conversations'> } }
function mapNativeSummary(summary: NativeSummary): ChatMeta {
  return { id: summary._id, title: summary.title, createdAt: summary.createdAt, updatedAt: summary.lastModified,
    lastMode: summary.lastMode, askModelIds: summary.askModelIds, actModelId: summary.actModelId,
    conversationType: 'personal', archivedAt: summary.archivedAt }
}
export async function loadChatsMeta(): Promise<ChatMeta[]> { return loadChatsMetaByView('personal') }
export type ChatListView = 'personal' | 'dms' | 'channels' | 'all'

function roomListArgs(view: ChatListView) {
  return { workspaceId: convexWorkspaceId(), kind: view === 'dms' ? 'dm' as const : view === 'channels' ? 'channel' as const : 'all' as const, limit: 500 }
}
type RoomList = NonNullable<FunctionReturnType<typeof api.collaboration.roomList.list>>
function roomMetas(result: RoomList | null): ChatMeta[] {
  return (result?.rooms ?? []).map(room => ({ id: room._id, title: room.title, createdAt: room.createdAt, updatedAt: room.updatedAt, conversationType: room.conversationType }))
}
export async function loadChatsMetaByView(view: ChatListView): Promise<ChatMeta[]> {
  const [personal, rooms] = await Promise.all([
    view === 'personal' || view === 'all' ? queryAllPages(api.chat.personal.list, { workspaceId: convexWorkspaceId(), archived: false }).then(rows => rows.map(mapNativeSummary)) : [],
    view !== 'personal' ? queryConvex(api.collaboration.roomList.list, roomListArgs(view)).then(roomMetas) : [],
  ])
  return [...personal, ...rooms].sort((a, b) => b.updatedAt - a.updatedAt)
}

export function subscribeChats(view: ChatListView, onValue: (chats: ChatMeta[]) => void) {
  let personal: ChatMeta[] = []
  let rooms: ChatMeta[] = []
  const emit = () => onValue([...personal, ...rooms].sort((a, b) => b.updatedAt - a.updatedAt))
  const stops: Array<() => void> = []
  if (view === 'personal' || view === 'all') stops.push(subscribeAllPages(api.chat.personal.list, { workspaceId: convexWorkspaceId(), archived: false }, rows => { personal = rows.map(mapNativeSummary); emit() }))
  if (view !== 'personal') stops.push(subscribeConvex(api.collaboration.roomList.list, roomListArgs(view), result => { rooms = roomMetas(result); emit() }))
  return () => stops.forEach(stop => stop())
}

export async function loadArchivedChats(): Promise<ChatMeta[]> {
  return (await queryAllPages(api.chat.personal.list, { workspaceId: convexWorkspaceId(), archived: true })).map(mapNativeSummary)
}
export async function setPersonalChatRead(id: string, unread = false, throughMessageId?: string): Promise<void> {
  await mutateConvex(api.chat.personal.setRead, { ...personalArgs(id), unread, throughMessageId: throughMessageId as Id<'conversationMessages'> | undefined })
}
export async function setPersonalChatArchived(id: string, archived: boolean): Promise<void> {
  await mutateConvex(api.chat.personal.setArchived, { ...personalArgs(id), archived })
}
export async function saveChat(chat: Chat): Promise<void> {
  if (chat.id.startsWith('chat-') && !chat.clientId) return
  await Promise.all([
    updateChatTitle(chat.id, chat.title),
    mutateConvex(api.chat.personal.setPreferences, {
      ...personalArgs(chat.id), askModelIds: chat.askModelIds ?? [], actModelId: chat.actModelId || chat.modelId || '', lastMode: chat.lastMode ?? 'act',
    }),
  ])
}
function nativeChat(summary: NativeSummary, rows: FunctionReturnType<typeof api.chat.personal.getMessages>['page']): Chat {
  const messages = mapNativePersonalMessageRows(rows)
  return { ...mapNativeSummary(summary), modelId: summary.actModelId || summary.askModelIds[0], messages,
    lastMessage: messages.at(-1)?.content.slice(0, 100) }
}
export async function loadChat(id: string): Promise<Chat | null> {
  const args = personalArgs(id)
  const summary = await queryConvex(api.chat.personal.getSummary, args)
  if (!summary) return null
  const rows = await queryAllPages(api.chat.personal.getMessages, args)
  const chat = nativeChat(summary, rows)
  void saveChatSnapshot(chat)
  return chat
}
export function subscribePersonalChat(id: string, onValue: (chat: Chat | null) => void) {
  const args = personalArgs(id)
  let summary: NativeSummary | null | undefined
  let rows: FunctionReturnType<typeof api.chat.personal.getMessages>['page'] | undefined
  let stopMessages: (() => void) | undefined
  let stopStreams: (() => void) | undefined
  let streams: ActivePublicStreamSnapshot[] = []
  let streamKey = ''
  const emit = () => {
    if (summary === null) { onValue(null); return }
    if (summary && rows) {
      const projected = projectActivePublicStreams(rows.map(row => row.message), streams)
      const chat = nativeChat(summary, rows.map((row, index) => ({ ...row, message: projected[index] })))
      void saveChatSnapshot(chat)
      onValue(chat)
    }
  }
  const stopSummary = subscribeConvex(api.chat.personal.getSummary, args, value => {
    summary = value
    if (!value) {
      stopMessages?.(); stopMessages = undefined; rows = undefined
      stopStreams?.(); stopStreams = undefined; streams = []; streamKey = ''
    } else if (!stopMessages) stopMessages = subscribeAllPages(api.chat.personal.getMessages, args, value => {
      rows = value
      const messageIds = rows.filter(row => row.message.status === 'generating').slice(0, 50).map(row => row.message._id)
      const key = messageIds.join(',')
      if (key !== streamKey) {
        stopStreams?.(); streams = []; streamKey = key
        stopStreams = messageIds.length ? subscribeConvex(api.chat.personal.activePublicStreams, { ...args, messageIds }, value => { streams = value; emit() }) : undefined
      }
      emit()
    })
    emit()
  })
  return () => { stopSummary(); stopMessages?.(); stopStreams?.() }
}
export async function deleteChat(id: string): Promise<void> {
  await appRequest('/api/v1/conversations', { method: 'DELETE', query: { conversationId: id } })
  if (await getLastOpenedChatId() === id) await AsyncStorage.removeItem(LAST_CHAT_ID_KEY)
  void removeChatSnapshot(id)
}

export async function getLastOpenedChatId(): Promise<string | null> {
  return AsyncStorage.getItem(LAST_CHAT_ID_KEY)
}

export async function setLastOpenedChatId(id: string): Promise<void> {
  await AsyncStorage.setItem(LAST_CHAT_ID_KEY, id)
}

export async function updateChatTitle(id: string, title: string): Promise<void> {
  await mutateConvex(api.chat.personal.rename, { ...personalArgs(id), title })
}

export async function updateChatMessages(_id: string, _messages: Message[]): Promise<void> {
  void _id
  void _messages
}

export async function createNewChat(
  modelId?: string,
  options: { title?: string; clientId?: string } = {},
): Promise<Chat> {
  const clientId = options.clientId ?? generateChatId()
  const id = await mutateConvex(api.chat.personal.create, {
    workspaceId: convexWorkspaceId(), clientId, title: options.title || 'New Chat',
    askModelIds: modelId ? [modelId] : [], actModelId: modelId ?? '', lastMode: 'act',
  })
  const chat = await loadChat(id)
  if (!chat) throw new Error('Could not open the new chat.')
  return { ...chat, clientId }
}
