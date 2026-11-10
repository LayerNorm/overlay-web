import AsyncStorage from '@react-native-async-storage/async-storage'
import type {
  ConversationMessage,
  ConversationSummary,
} from '@overlay/app-core'
import { normalizeTranscriptAssistantParts } from '@overlay/chat-core'
import { appJson, appRequest } from './appApi'
import {
  generateChatId,
  getConversationSummaryLastMessage,
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

function toMessageContent(parts: ConversationMessage['parts']): string {
  return parts
    .filter((part) => part.type === 'text')
    .map((part) => part.text || '')
    .join('')
}

function mapConversationMessageToMessage(message: ConversationMessage): Message {
  const text = toMessageContent(message.parts)
  const generatedFiles = message.parts
    .filter(
      (part): part is Extract<ConversationMessage['parts'][number], { type: 'file' }> =>
        part.type === 'file' && !!part.url,
    )
    .map((part) => ({
      url: part.url!,
      mediaType: part.mediaType || 'application/octet-stream',
    }))

  const toolInvocations = message.parts
    .filter((part) => part.type === 'tool-invocation')
    .map((part) => ({
      toolCallId: part.toolInvocation.toolCallId,
      toolName: part.toolInvocation.toolName,
      state: part.toolInvocation.state,
      toolInput: part.toolInvocation.toolInput,
      toolOutput: part.toolInvocation.toolOutput,
    }))

  // Normalized render model — same normalizer the web transcript uses, so
  // reasoning, grouped tools, sources, and generated-ui survive the round trip.
  const { blocks, sources } = message.role === 'assistant'
    ? normalizeTranscriptAssistantParts(message.parts)
    : { blocks: undefined, sources: undefined }

  return {
    id: message.id,
    blocks,
    transcriptSources: sources,
    turnId: message.turnId,
    role: message.role,
    content: text,
    timestamp: Date.now(),
    selectedModelId: message.model,
    responses:
      message.role === 'assistant'
        ? [
            {
              modelId: message.model || message.routedModelId || 'overlay',
              modelName: message.routedModelId || message.model || 'Overlay',
              provider: 'overlay',
              content: text,
              isLoading: false,
            },
          ]
        : undefined,
    generatedFiles: generatedFiles.length > 0 ? generatedFiles : undefined,
    toolInvocations: toolInvocations.length > 0 ? toolInvocations : undefined,
    mode: message.mode,
    replyToTurnId: message.replyToTurnId,
    replySnippet: message.replySnippet,
    routedModelId: message.routedModelId,
  }
}

function mapConversationSummary(summary: ConversationSummary): ChatMeta {
  const runtime = summary as ConversationSummary & {
    conversationType?: 'personal' | 'dm' | 'channel'
    archivedAt?: number
  }
  return {
    id: summary._id,
    title: summary.title,
    createdAt: summary.createdAt,
    updatedAt: summary.updatedAt,
    lastMessage: undefined,
    lastMode: summary.lastMode,
    askModelIds: summary.askModelIds,
    actModelId: summary.actModelId,
    clientId: summary.clientId,
    conversationType: runtime.conversationType,
    archivedAt: runtime.archivedAt,
  }
}

export async function loadChatsMeta(): Promise<ChatMeta[]> {
  const summaries = await appJson<ConversationSummary[]>('/api/v1/conversations')
  return summaries
    .map(mapConversationSummary)
    .sort((a, b) => b.updatedAt - a.updatedAt)
}

export type ChatListView = 'personal' | 'dms' | 'channels' | 'all'

/**
 * Collaboration-aware list — `?view=` returns a paginated envelope
 * (`{ data, nextCursor, hasMore }`) unlike the bare-array default list.
 * Mirrors the web sidebar's Personal/DMs/Channels/All filtering.
 */
export async function loadChatsMetaByView(view: ChatListView): Promise<ChatMeta[]> {
  const response = await appJson<{ data?: ConversationSummary[] } | ConversationSummary[]>(
    '/api/v1/conversations',
    { query: { view, limit: 100 } },
  )
  const summaries = Array.isArray(response) ? response : (response.data ?? [])
  return summaries
    .map(mapConversationSummary)
    .sort((a, b) => b.updatedAt - a.updatedAt)
}

/** Archived conversations — `GET /conversations?archived=true` (web ChatArchivedView). */
export async function loadArchivedChats(): Promise<ChatMeta[]> {
  const summaries = await appJson<ConversationSummary[]>('/api/v1/conversations', {
    query: { archived: true },
  })
  return summaries
    .map(mapConversationSummary)
    .sort((a, b) => (b.archivedAt ?? b.updatedAt) - (a.archivedAt ?? a.updatedAt))
}

export async function saveChat(chat: Chat): Promise<void> {
  await appJson('/api/v1/conversations', {
    method: 'PATCH',
    json: {
      conversationId: chat.id,
      title: chat.title,
      askModelIds: chat.askModelIds,
      actModelId: chat.actModelId || chat.modelId,
      lastMode: chat.lastMode,
    },
  })
}

export async function loadChat(id: string): Promise<Chat | null> {
  try {
    const [summary, messagesResponse] = await Promise.all([
      appJson<ConversationSummary>(`/api/v1/conversations`, {
        query: { conversationId: id },
      }),
      appJson<{ messages: ConversationMessage[] }>(`/api/v1/conversations`, {
        query: { conversationId: id, messages: true },
      }),
    ])

    const messages = messagesResponse.messages.map(mapConversationMessageToMessage)
    const chat: Chat = {
      ...mapConversationSummary(summary),
      lastMessage: getConversationSummaryLastMessage(summary, messagesResponse.messages),
      modelId: summary.actModelId || summary.askModelIds[0],
      messages,
    }
    void saveChatSnapshot(chat)
    return chat
  } catch {
    // Read-through: server unreachable → fall back to the last synced copy.
    return loadChatSnapshot(id)
  }
}

export async function deleteChat(id: string): Promise<void> {
  await appRequest('/api/v1/conversations', {
    method: 'DELETE',
    query: { conversationId: id },
  })

  const lastId = await getLastOpenedChatId()
  if (lastId === id) {
    await AsyncStorage.removeItem(LAST_CHAT_ID_KEY)
  }
  void removeChatSnapshot(id)
}

export async function getLastOpenedChatId(): Promise<string | null> {
  return AsyncStorage.getItem(LAST_CHAT_ID_KEY)
}

export async function setLastOpenedChatId(id: string): Promise<void> {
  await AsyncStorage.setItem(LAST_CHAT_ID_KEY, id)
}

export async function updateChatTitle(id: string, title: string): Promise<void> {
  await appJson('/api/v1/conversations', {
    method: 'PATCH',
    json: { conversationId: id, title },
  })
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
  const response = await appJson<{
    id: string
    conversation: ConversationSummary
  }>('/api/v1/conversations', {
    method: 'POST',
    json: {
      clientId,
      title: options.title || 'New Chat',
      askModelIds: modelId ? [modelId] : undefined,
      actModelId: modelId,
      lastMode: 'act',
    },
  })

  const conversation = response.conversation
  return {
    ...mapConversationSummary(conversation),
    id: conversation._id,
    modelId: conversation.actModelId || conversation.askModelIds[0],
    messages: [],
    clientId,
  }
}
