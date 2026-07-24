import { overlayDesktopAppClient } from './app-api-client'
import type { ConversationSummary } from '@overlay/app-core'
import type { PaginatedEnvelope } from '@overlay/api-client'

export type CachedChat = ConversationSummary

export const INITIAL_CHAT_LIST_LIMIT = 24

export type ChatListPageInfo = {
  nextCursor?: string
  hasMore: boolean
}

export type ChatListFetchOutcome =
  | { status: 'success'; chats: CachedChat[] }
  | { status: 'unauthenticated' }
  | { status: 'error' }

let cachedChats: CachedChat[] | null = null
let cachedAt = 0
let inFlight: Promise<ChatListFetchOutcome> | null = null
let cachedPageInfo: ChatListPageInfo = { hasMore: false }

const CACHE_TTL_MS = 15_000

export function getCachedChatList(): CachedChat[] | null {
  return cachedChats
}

export function getCachedChatListPageInfo(): ChatListPageInfo {
  return cachedPageInfo
}

export function clearChatListCache(): void {
  cachedChats = null
  cachedAt = 0
  cachedPageInfo = { hasMore: false }
}

export async function fetchChatListResult(
  options: { force?: boolean } = {}
): Promise<ChatListFetchOutcome> {
  const now = Date.now()
  if (!options.force && cachedChats && now - cachedAt < CACHE_TTL_MS) {
    return { status: 'success', chats: cachedChats }
  }
  if (!options.force && inFlight) return inFlight

  inFlight = overlayDesktopAppClient.conversations
    .getResponse({ limit: INITIAL_CHAT_LIST_LIMIT })
    .then(async (res): Promise<ChatListFetchOutcome> => {
      if (!res.ok) {
        if (res.status === 401 || res.status === 403) return { status: 'unauthenticated' }
        return { status: 'error' }
      }
      const payload = (await res.json()) as PaginatedEnvelope<ConversationSummary>
      if (!payload || typeof payload !== 'object' || !Array.isArray(payload.data)) {
        return { status: 'error' }
      }
      const chats = payload.data
      cachedChats = sortByLastModified(chats)
      cachedPageInfo = {
        nextCursor: payload.nextCursor,
        hasMore: payload.hasMore
      }
      cachedAt = Date.now()
      return { status: 'success', chats }
    })
    .catch((): ChatListFetchOutcome => ({ status: 'error' }))
    .finally(() => {
      inFlight = null
    })

  return inFlight
}

export async function fetchChatList(options: { force?: boolean } = {}): Promise<CachedChat[]> {
  const outcome = await fetchChatListResult(options)
  if (outcome.status === 'success') return outcome.chats
  if (outcome.status === 'unauthenticated') {
    clearChatListCache()
    return []
  }
  return cachedChats ?? []
}

function sortByLastModified(chats: CachedChat[]): CachedChat[] {
  return [...chats].sort((a, b) => {
    const bTime = b.lastModified ?? b.updatedAt ?? 0
    const aTime = a.lastModified ?? a.updatedAt ?? 0
    return bTime - aTime
  })
}
