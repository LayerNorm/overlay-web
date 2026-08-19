import { overlayAppClient } from '@/shared/app/overlay-app-client'
import { isPaginatedEnvelope, type PaginatedEnvelope } from '@/shared/api/pagination'
import { trackCacheState } from '@/shared/observability/client-metrics'
import { recordRequest } from '@/shared/observability/duplicate-tracker'

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
  workspaceId?: string
  conversationType?: 'personal' | 'dm' | 'channel'
  otherParticipantTypes?: Array<'human' | 'agent'>
  createdByPrincipalId?: string
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
  | { status: 'rate-limited'; retryAfterMs: number }
  | { status: 'error' }

type WorkspaceChatListCache = {
  cachedChats: CachedConversation[] | null
  cachedAt: number
  inFlight: Promise<ChatListFetchOutcome> | null
  nextPageInFlight: Promise<CachedConversation[]> | null
  cachedPageInfo: ChatListPageInfo
  pendingEmptyChats: Map<string, { chat: CachedConversation; expiresAt: number }>
  rateLimitedUntil: number
}

const LEGACY_WORKSPACE_KEY = '__legacy_personal_workspace__'
const workspaceCaches = new Map<string, WorkspaceChatListCache>()
let activeWorkspaceKey = LEGACY_WORKSPACE_KEY
let activeChatView: 'personal' | 'dms' | 'channels' | 'all' = 'personal'

function activeCacheKey() {
  return `${activeWorkspaceKey}:${activeChatView}`
}

function createWorkspaceCache(): WorkspaceChatListCache {
  return {
    cachedChats: null,
    cachedAt: 0,
    inFlight: null,
    nextPageInFlight: null,
    cachedPageInfo: { hasMore: false },
    pendingEmptyChats: new Map(),
    rateLimitedUntil: 0,
  }
}

function retryAfterMs(response: Response): number {
  const retryAfter = response.headers.get('Retry-After')?.trim()
  if (!retryAfter) return 30_000

  const seconds = Number(retryAfter)
  if (Number.isFinite(seconds) && seconds >= 0) return Math.max(1_000, Math.ceil(seconds * 1_000))

  const retryAt = Date.parse(retryAfter)
  if (Number.isFinite(retryAt)) return Math.max(1_000, retryAt - Date.now())
  return 30_000
}

function getWorkspaceCache(workspaceKey = activeCacheKey()): WorkspaceChatListCache {
  const existing = workspaceCaches.get(workspaceKey)
  if (existing) return existing
  const created = createWorkspaceCache()
  workspaceCaches.set(workspaceKey, created)
  return created
}

export function setActiveChatListWorkspace(workspaceId: string | null | undefined) {
  activeWorkspaceKey = workspaceId || LEGACY_WORKSPACE_KEY
  getWorkspaceCache()
}

export function setActiveChatListView(view: typeof activeChatView) {
  activeChatView = view
  getWorkspaceCache()
}

export function getActiveChatListWorkspace(): string | null {
  return activeWorkspaceKey === LEGACY_WORKSPACE_KEY ? null : activeWorkspaceKey
}

function sortByLastModified(chats: CachedConversation[]): CachedConversation[] {
  return [...chats].sort((a, b) => {
    const bTime = b.lastModified ?? b.updatedAt ?? b.createdAt ?? 0
    const aTime = a.lastModified ?? a.updatedAt ?? a.createdAt ?? 0
    return bTime - aTime
  })
}

export function getCachedChatList(): CachedConversation[] | null {
  return getWorkspaceCache().cachedChats
}

export function getCachedChatListPageInfo(): ChatListPageInfo {
  return getWorkspaceCache().cachedPageInfo
}

export function primeChatList(
  chats: CachedConversation[],
  pageInfo: ChatListPageInfo = { hasMore: false },
  workspaceKey = activeCacheKey(),
) {
  const cache = getWorkspaceCache(workspaceKey)
  cache.cachedChats = sortByLastModified(chats)
  cache.cachedPageInfo = pageInfo
  cache.cachedAt = Date.now()
}

export function upsertCachedChat(chat: CachedConversation) {
  const cache = getWorkspaceCache()
  const current = cache.cachedChats ?? []
  const existing = current.find((item) => item._id === chat._id)
  const merged = existing ? { ...existing, ...chat } : chat
  cache.cachedChats = sortByLastModified([merged, ...current.filter((item) => item._id !== chat._id)])
  cache.cachedAt = Date.now()
}

export function markNewEmptyChat(chat: CachedConversation) {
  getWorkspaceCache().pendingEmptyChats.set(chat._id, {
    chat,
    expiresAt: Date.now() + NEW_EMPTY_CHAT_TTL_MS,
  })
}

export function consumeNewEmptyChat(chatId: string): CachedConversation | null {
  const pendingEmptyChats = getWorkspaceCache().pendingEmptyChats
  const entry = pendingEmptyChats.get(chatId)
  pendingEmptyChats.delete(chatId)
  if (!entry || entry.expiresAt < Date.now()) return null
  return entry.chat
}

export function removeCachedChat(chatId: string) {
  const cache = getWorkspaceCache()
  if (!cache.cachedChats) return
  cache.cachedChats = cache.cachedChats.filter((chat) => chat._id !== chatId)
  cache.cachedAt = Date.now()
}

export function clearChatListCache() {
  workspaceCaches.delete(activeCacheKey())
}

export function clearAllChatListCaches() {
  workspaceCaches.clear()
}

export async function fetchChatListResult(options: { force?: boolean } = {}): Promise<ChatListFetchOutcome> {
  const requestWorkspaceKey = activeCacheKey()
  const requestView = activeChatView
  const cache = getWorkspaceCache(requestWorkspaceKey)
  const now = Date.now()
  if (!options.force && cache.cachedChats && now - cache.cachedAt < CACHE_TTL_MS) {
    trackCacheState({
      resource: 'chat_list',
      key: requestWorkspaceKey,
      state: 'hit',
      ttlMs: CACHE_TTL_MS,
      ageMs: now - cache.cachedAt,
    })
    return { status: 'success', chats: cache.cachedChats }
  }
  if (options.force && cache.cachedChats) {
    trackCacheState({
      resource: 'chat_list',
      key: requestWorkspaceKey,
      state: 'stale',
      ttlMs: CACHE_TTL_MS,
      ageMs: now - cache.cachedAt,
    })
  } else if (!cache.cachedChats) {
    trackCacheState({
      resource: 'chat_list',
      key: requestWorkspaceKey,
      state: 'miss',
    })
  }
  recordRequest(`chat_list:${requestWorkspaceKey}`)
  // `force` bypasses the display TTL, not request coalescing. The app shell and
  // active chat can ask for the same refresh concurrently after a reconnect.
  // Sharing the promise prevents those refresh sources from multiplying one
  // logical invalidation into several identical network requests.
  if (cache.inFlight) return cache.inFlight
  if (cache.rateLimitedUntil > now) {
    return { status: 'rate-limited', retryAfterMs: cache.rateLimitedUntil - now }
  }

  cache.inFlight = overlayAppClient.conversations.getResponse({
    limit: INITIAL_CHAT_LIST_LIMIT,
    view: requestView,
  })
    .then(async (res): Promise<ChatListFetchOutcome> => {
      if (!res.ok) {
        if (res.status === 401 || res.status === 403) return { status: 'unauthenticated' }
        if (res.status === 429) {
          const cooldownMs = retryAfterMs(res)
          cache.rateLimitedUntil = Date.now() + cooldownMs
          return { status: 'rate-limited', retryAfterMs: cooldownMs }
        }
        return { status: 'error' }
      }
      cache.rateLimitedUntil = 0
      const payload = await res.json()
      if (!isPaginatedEnvelope<CachedConversation>(payload)) return { status: 'error' }
      primeChatList(payload.data, {
        nextCursor: payload.nextCursor,
        hasMore: payload.hasMore,
      }, requestWorkspaceKey)
      return { status: 'success', chats: payload.data }
    })
    .catch((): ChatListFetchOutcome => ({ status: 'error' }))
    .finally(() => {
      cache.inFlight = null
    })

  return cache.inFlight
}

export async function fetchChatList(options: { force?: boolean } = {}): Promise<CachedConversation[]> {
  const outcome = await fetchChatListResult(options)
  if (outcome.status === 'success') return outcome.chats
  // A guest (or expired session) must not keep seeing previously cached
  // conversations from an authenticated session.
  if (outcome.status === 'unauthenticated') {
    clearAllChatListCaches()
    return []
  }
  return getCachedChatList() ?? []
}

export async function fetchNextChatListPage(): Promise<CachedConversation[]> {
  const requestWorkspaceKey = activeCacheKey()
  const requestView = activeChatView
  const cache = getWorkspaceCache(requestWorkspaceKey)
  if (!cache.cachedPageInfo.hasMore || !cache.cachedPageInfo.nextCursor) return cache.cachedChats ?? []
  if (cache.nextPageInFlight) return cache.nextPageInFlight

  cache.nextPageInFlight = overlayAppClient.conversations.getResponse({
    cursor: cache.cachedPageInfo.nextCursor,
    limit: INITIAL_CHAT_LIST_LIMIT,
    view: requestView,
  })
    .then(async (res) => {
      const requestCache = getWorkspaceCache(requestWorkspaceKey)
      if (!res.ok) return requestCache.cachedChats ?? []
      const payload = await res.json() as PaginatedEnvelope<CachedConversation>
      if (!isPaginatedEnvelope<CachedConversation>(payload)) return requestCache.cachedChats ?? []
      const current = requestCache.cachedChats ?? []
      const byId = new Map(current.map((chat) => [chat._id, chat]))
      for (const chat of payload.data) {
        byId.set(chat._id, { ...byId.get(chat._id), ...chat })
      }
      const merged = [...byId.values()]
      primeChatList(merged, {
        nextCursor: payload.nextCursor,
        hasMore: payload.hasMore,
      }, requestWorkspaceKey)
      return getWorkspaceCache(requestWorkspaceKey).cachedChats ?? merged
    })
    .finally(() => {
      getWorkspaceCache(requestWorkspaceKey).nextPageInFlight = null
    })

  return cache.nextPageInFlight
}
