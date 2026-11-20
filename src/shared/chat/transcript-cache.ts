/**
 * Bounded in-memory cache of recently opened transcripts, so a revisited or
 * prefetched conversation paints before its live subscriptions answer.
 *
 * Entries are keyed by user, workspace, conversation kind, conversation and
 * query variant. Changing identity clears everything and bumps a generation
 * that late prefetch results must still match. Cached content is display-only:
 * it never authorizes an action, and live authorized data replaces it.
 */

export type TranscriptCacheKind = 'personal' | 'room'

export type TranscriptCacheScope = { userId: string; workspaceId: string }

export type TranscriptCacheTarget = {
  kind: TranscriptCacheKind
  conversationId: string
  variant?: string
}

/** Where the reader was: following the newest message, or a row and its offset from the viewport top. */
export type TranscriptScrollSnapshot = { atBottom: boolean; anchorId: string | null; offset: number }

export type TranscriptCacheEntry<Item = unknown, Summary = unknown> = {
  /** Newest-first, exactly as the live paginated query returns them. */
  items: Item[]
  summary: Summary
  /** Items the live query should request so its first page matches this snapshot. */
  loadedCount: number
  isDone: boolean
  bytes: number
  storedAt: number
  source: 'live' | 'prefetch'
}

export type TranscriptCacheLimits = {
  maxEntries: number
  /** Matches the backend's 100-item page cap, so one live page can replace a restored snapshot. */
  maxItemsPerEntry: number
  maxBytes: number
  /** A snapshot older than this is not restored. */
  maxAgeMs: number
}

export const DEFAULT_TRANSCRIPT_CACHE_LIMITS: TranscriptCacheLimits = {
  maxEntries: 24,
  maxItemsPerEntry: 100,
  maxBytes: 8 * 1024 * 1024,
  maxAgeMs: 30 * 60 * 1000,
}

const SEPARATOR = '\u0000'

export function transcriptCacheKey(scope: TranscriptCacheScope, target: TranscriptCacheTarget): string {
  return [target.kind, scope.userId, scope.workspaceId, target.conversationId, target.variant ?? ''].join(SEPARATOR)
}

function estimateBytes(value: unknown): number {
  try {
    return (JSON.stringify(value)?.length ?? 0) * 2
  } catch {
    return Number.POSITIVE_INFINITY
  }
}

export function createTranscriptCache(limits: TranscriptCacheLimits = DEFAULT_TRANSCRIPT_CACHE_LIMITS,
  now: () => number = Date.now) {
  const entries = new Map<string, TranscriptCacheEntry>()
  const scrolls = new Map<string, TranscriptScrollSnapshot>()
  let identity: string | null = null
  let generation = 0
  let totalBytes = 0

  const remove = (key: string) => {
    const entry = entries.get(key)
    if (entry) totalBytes -= entry.bytes
    entries.delete(key)
    scrolls.delete(key)
  }

  const clear = () => {
    entries.clear()
    scrolls.clear()
    totalBytes = 0
    generation += 1
  }

  const owns = (key: string) => identity !== null && key.split(SEPARATOR).slice(1, 3).join(SEPARATOR) === identity

  return {
    /** Sets the signed-in user and active workspace; any change clears every entry. */
    setIdentity(scope: TranscriptCacheScope | null) {
      const next = scope ? scope.userId + SEPARATOR + scope.workspaceId : null
      if (next === identity) return
      identity = next
      clear()
    },
    generation: () => generation,
    clear,
    get<Item, Summary>(key: string): TranscriptCacheEntry<Item, Summary> | null {
      const entry = entries.get(key)
      if (!entry || !owns(key)) return null
      if (now() - entry.storedAt > limits.maxAgeMs) {
        remove(key)
        return null
      }
      entries.delete(key)
      entries.set(key, entry)
      return entry as TranscriptCacheEntry<Item, Summary>
    },
    /**
     * Stores a newest-first snapshot. Returns false when the write belongs to an
     * older identity generation or another identity, or does not fit.
     */
    put<Item, Summary>(key: string, value: {
      items: readonly Item[]
      summary: Summary
      isDone: boolean
      source: 'live' | 'prefetch'
    }, expectedGeneration = generation): boolean {
      if (expectedGeneration !== generation || !owns(key)) return false
      const items = value.items.slice(0, limits.maxItemsPerEntry)
      const bytes = estimateBytes(items) + estimateBytes(value.summary)
      const scroll = scrolls.get(key)
      remove(key)
      if (scroll) scrolls.set(key, scroll)
      if (bytes > limits.maxBytes) return false
      entries.set(key, {
        items,
        summary: value.summary,
        loadedCount: items.length,
        isDone: value.isDone && items.length === value.items.length,
        bytes,
        storedAt: now(),
        source: value.source,
      })
      totalBytes += bytes
      for (const oldest of entries.keys()) {
        if (entries.size <= limits.maxEntries && totalBytes <= limits.maxBytes) break
        remove(oldest)
      }
      return true
    },
    /** Known inaccessible or deleted: forget it. */
    evict(key: string) { remove(key) },
    saveScroll(key: string, snapshot: TranscriptScrollSnapshot) {
      if (!owns(key)) return
      scrolls.delete(key)
      scrolls.set(key, snapshot)
      for (const oldest of scrolls.keys()) {
        if (scrolls.size <= limits.maxEntries) break
        scrolls.delete(oldest)
      }
    },
    scroll(key: string): TranscriptScrollSnapshot | null {
      return owns(key) ? scrolls.get(key) ?? null : null
    },
    stats: () => ({ entries: entries.size, bytes: totalBytes, scrolls: scrolls.size, generation }),
  }
}

export type TranscriptCache = ReturnType<typeof createTranscriptCache>

/** The page size a live paginated query should request to reproduce a restored snapshot. */
export function restoredPageSize(entry: { loadedCount: number } | null, pageSize: number, maxPage = 100): number {
  if (!entry) return pageSize
  return Math.max(pageSize, Math.min(maxPage, entry.loadedCount))
}
