import { desktopAppJson, overlayDesktopAppClient } from './app-api-client'
import type { ConversationSummary } from '@overlay/app-core'
import type { PaginatedEnvelope } from '@overlay/api-client'

export type CachedChat = ConversationSummary

/** Mirrors the web secondary-panel chat views (backed by server `view` + `archived`). */
export type ChatListView = 'personal' | 'dms' | 'channels' | 'all' | 'archived'

export const CHAT_LIST_VIEWS: readonly ChatListView[] = [
  'personal',
  'dms',
  'channels',
  'all',
  'archived'
]

export const INITIAL_CHAT_LIST_LIMIT = 24

export type ChatListPageInfo = {
  nextCursor?: string
  hasMore: boolean
}

export type ChatListFetchOutcome =
  | { status: 'success'; chats: CachedChat[] }
  | { status: 'unauthenticated' }
  | { status: 'error' }

interface ViewCache {
  chats: CachedChat[] | null
  at: number
  pageInfo: ChatListPageInfo
  inFlight: Promise<ChatListFetchOutcome> | null
}

const CACHE_TTL_MS = 15_000

const viewCaches = new Map<ChatListView, ViewCache>()

function viewCache(view: ChatListView): ViewCache {
  let cache = viewCaches.get(view)
  if (!cache) {
    cache = { chats: null, at: 0, pageInfo: { hasMore: false }, inFlight: null }
    viewCaches.set(view, cache)
  }
  return cache
}

export function isChatListView(value: string): value is ChatListView {
  return (CHAT_LIST_VIEWS as readonly string[]).includes(value)
}

export function getCachedChatList(view: ChatListView = 'personal'): CachedChat[] | null {
  return viewCache(view).chats
}

export function getCachedChatListPageInfo(view: ChatListView = 'personal'): ChatListPageInfo {
  return viewCache(view).pageInfo
}

export function clearChatListCache(view?: ChatListView): void {
  if (view) {
    viewCaches.delete(view)
    return
  }
  viewCaches.clear()
}

function isEnvelope(value: unknown): value is PaginatedEnvelope<ConversationSummary> {
  return (
    typeof value === 'object' &&
    value !== null &&
    Array.isArray((value as { data?: unknown }).data)
  )
}

export async function fetchChatListResult(
  options: { force?: boolean; view?: ChatListView } = {}
): Promise<ChatListFetchOutcome> {
  const view = options.view ?? 'personal'
  const cache = viewCache(view)
  const now = Date.now()
  if (!options.force && cache.chats && now - cache.at < CACHE_TTL_MS) {
    return { status: 'success', chats: cache.chats }
  }
  if (!options.force && cache.inFlight) return cache.inFlight

  // The archived view returns a bare array; every other view returns the
  // paginated envelope (the server only envelopes when limit/view is present,
  // and we always send a limit).
  const request =
    view === 'archived'
      ? desktopAppJson<unknown>('/api/v1/conversations?archived=true')
          .then((raw): ChatListFetchOutcome => {
            const chats = Array.isArray(raw) ? (raw as CachedChat[]) : []
            cache.chats = sortByLastModified(chats)
            cache.pageInfo = { hasMore: false }
            cache.at = Date.now()
            return { status: 'success', chats }
          })
          .catch((): ChatListFetchOutcome => ({ status: 'error' }))
      : overlayDesktopAppClient.conversations
          .getResponse({
            limit: INITIAL_CHAT_LIST_LIMIT,
            ...(view === 'personal' ? {} : { view })
          } as { limit: number; view?: string })
          .then(async (res): Promise<ChatListFetchOutcome> => {
            if (!res.ok) {
              if (res.status === 401 || res.status === 403) return { status: 'unauthenticated' }
              return { status: 'error' }
            }
            const payload = (await res.json()) as unknown
            if (!isEnvelope(payload)) {
              return { status: 'error' }
            }
            const chats = payload.data
            cache.chats = sortByLastModified(chats)
            cache.pageInfo = {
              nextCursor: payload.nextCursor,
              hasMore: payload.hasMore
            }
            cache.at = Date.now()
            return { status: 'success', chats }
          })
          .catch((): ChatListFetchOutcome => ({ status: 'error' }))

  cache.inFlight = request.finally(() => {
    cache.inFlight = null
  })

  return cache.inFlight
}

export async function fetchChatList(
  options: { force?: boolean; view?: ChatListView } = {}
): Promise<CachedChat[]> {
  const outcome = await fetchChatListResult(options)
  if (outcome.status === 'success') return outcome.chats
  if (outcome.status === 'unauthenticated') {
    clearChatListCache(options.view)
    return []
  }
  return getCachedChatList(options.view) ?? []
}

function sortByLastModified(chats: CachedChat[]): CachedChat[] {
  return [...chats].sort((a, b) => {
    const bTime = b.lastModified ?? b.updatedAt ?? 0
    const aTime = a.lastModified ?? a.updatedAt ?? 0
    return bTime - aTime
  })
}
