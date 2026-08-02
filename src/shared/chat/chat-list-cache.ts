import { overlayAppClient } from '@/shared/app/overlay-app-client'
import { isPaginatedEnvelope, type PaginatedEnvelope } from '@/shared/api/pagination'

export type CachedConversation = {
  _id: string
  title: string
  lastModified: number
  createdAt?: number
  updatedAt?: number
  lastMode?: 'ask' | 'act'
  askModelIds?: string[]
  modelIds?: string[]
  actModelId?: string
}

const CACHE_TTL_MS = 15_000
const NEW_EMPTY_CHAT_TTL_MS = 30_000
export const INITIAL_CHAT_LIST_LIMIT = 24

export type ChatListPageInfo = {
  nextCursor?: string
  hasMore: boolean
}

/**
 * Distinguishes a successful fetch (even one that returns zero chats) from a
 * transient failure. This matters on first paint: an authenticated session can
 * briefly receive a 401 from the BFF while the Convex token is still being
 * minted. In that window we must NOT treat the response as "no chats" — the
 * caller should keep its loading state and retry.
 */
export type ChatListFetchOutcome =
  | { status: 'success'; chats: CachedConversation[] }
  | { status: 'unauthenticated' }
  | { status: 'error' }

let cachedChats: CachedConversation[] | null = null
let cachedAt = 0
let inFlight: Promise<ChatListFetchOutcome> | null = null
let nextPageInFlight: Promise<CachedConversation[]> | null = null
let cachedPageInfo: ChatListPageInfo = { hasMore: false }
const pendingEmptyChats = new Map<string, { chat: CachedConversation; expiresAt: number }>()

function sortByLastModified(chats: CachedConversation[]): CachedConversation[] {
  return [...chats].sort((a, b) => {
    const bTime = b.lastModified ?? b.updatedAt ?? b.createdAt ?? 0
    const aTime = a.lastModified ?? a.updatedAt ?? a.createdAt ?? 0
    return bTime - aTime
  })
}

export function getCachedChatList(): CachedConversation[] | null {
  return cachedChats
}

export function getCachedChatListPageInfo(): ChatListPageInfo {
  return cachedPageInfo
}

export function primeChatList(
  chats: CachedConversation[],
  pageInfo: ChatListPageInfo = { hasMore: false },
) {
  cachedChats = sortByLastModified(chats)
  cachedPageInfo = pageInfo
  cachedAt = Date.now()
}

export function upsertCachedChat(chat: CachedConversation) {
  const current = cachedChats ?? []
  const existing = current.find((item) => item._id === chat._id)
  const merged = existing ? { ...existing, ...chat } : chat
  cachedChats = sortByLastModified([merged, ...current.filter((item) => item._id !== chat._id)])
  cachedAt = Date.now()
}

export function markNewEmptyChat(chat: CachedConversation) {
  pendingEmptyChats.set(chat._id, {
    chat,
    expiresAt: Date.now() + NEW_EMPTY_CHAT_TTL_MS,
  })
}

export function consumeNewEmptyChat(chatId: string): CachedConversation | null {
  const entry = pendingEmptyChats.get(chatId)
  pendingEmptyChats.delete(chatId)
  if (!entry || entry.expiresAt < Date.now()) return null
  return entry.chat
}

export function removeCachedChat(chatId: string) {
  if (!cachedChats) return
  cachedChats = cachedChats.filter((chat) => chat._id !== chatId)
  cachedAt = Date.now()
}

export function clearChatListCache() {
  cachedChats = null
  cachedAt = 0
  cachedPageInfo = { hasMore: false }
  pendingEmptyChats.clear()
}

export async function fetchChatListResult(options: { force?: boolean } = {}): Promise<ChatListFetchOutcome> {
  const now = Date.now()
  if (!options.force && cachedChats && now - cachedAt < CACHE_TTL_MS) {
    return { status: 'success', chats: cachedChats }
  }
  if (!options.force && inFlight) return inFlight

  inFlight = overlayAppClient.conversations.getResponse({ limit: INITIAL_CHAT_LIST_LIMIT })
    .then(async (res): Promise<ChatListFetchOutcome> => {
      if (!res.ok) {
        if (res.status === 401 || res.status === 403) return { status: 'unauthenticated' }
        return { status: 'error' }
      }
      const payload = await res.json()
      if (!isPaginatedEnvelope<CachedConversation>(payload)) return { status: 'error' }
      primeChatList(payload.data, {
        nextCursor: payload.nextCursor,
        hasMore: payload.hasMore,
      })
      return { status: 'success', chats: payload.data }
    })
    .catch((): ChatListFetchOutcome => ({ status: 'error' }))
    .finally(() => {
      inFlight = null
    })

  return inFlight
}

export async function fetchChatList(options: { force?: boolean } = {}): Promise<CachedConversation[]> {
  const outcome = await fetchChatListResult(options)
  if (outcome.status === 'success') return outcome.chats
  // A guest (or expired session) must not keep seeing previously cached
  // conversations from an authenticated session.
  if (outcome.status === 'unauthenticated') {
    clearChatListCache()
    return []
  }
  return cachedChats ?? []
}

export async function fetchNextChatListPage(): Promise<CachedConversation[]> {
  if (!cachedPageInfo.hasMore || !cachedPageInfo.nextCursor) return cachedChats ?? []
  if (nextPageInFlight) return nextPageInFlight

  nextPageInFlight = overlayAppClient.conversations.getResponse({
    cursor: cachedPageInfo.nextCursor,
    limit: INITIAL_CHAT_LIST_LIMIT,
  })
    .then(async (res) => {
      if (!res.ok) return cachedChats ?? []
      const payload = await res.json() as PaginatedEnvelope<CachedConversation>
      if (!isPaginatedEnvelope<CachedConversation>(payload)) return cachedChats ?? []
      const current = cachedChats ?? []
      const byId = new Map(current.map((chat) => [chat._id, chat]))
      for (const chat of payload.data) {
        byId.set(chat._id, { ...byId.get(chat._id), ...chat })
      }
      const merged = [...byId.values()]
      primeChatList(merged, {
        nextCursor: payload.nextCursor,
        hasMore: payload.hasMore,
      })
      return getCachedChatList() ?? merged
    })
    .finally(() => {
      nextPageInFlight = null
    })

  return nextPageInFlight
}
