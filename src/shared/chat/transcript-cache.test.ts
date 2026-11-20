import { expect, test } from 'vitest'
import { createTranscriptCache, restoredPageSize, transcriptCacheKey } from './transcript-cache'

const alice = { userId: 'alice', workspaceId: 'w1' }
const key = (conversationId: string, scope = alice, variant?: string) =>
  transcriptCacheKey(scope, { kind: 'personal', conversationId, variant })
const limits = { maxEntries: 3, maxItemsPerEntry: 4, maxBytes: 10_000, maxAgeMs: 60_000 }
const snapshot = (items: unknown[], isDone = true) => ({ items, summary: { title: 't' }, isDone, source: 'live' as const })

test('keys separate user, workspace, kind, conversation and variant', () => {
  const keys = new Set([
    key('c1'), key('c2'), key('c1', { userId: 'bob', workspaceId: 'w1' }), key('c1', { userId: 'alice', workspaceId: 'w2' }),
    key('c1', alice, 'state'), transcriptCacheKey(alice, { kind: 'room', conversationId: 'c1' }),
  ])
  expect(keys.size).toBe(6)
})

test('reads and writes only within the current identity, and an identity change clears everything', () => {
  const cache = createTranscriptCache(limits)
  expect(cache.put(key('c1'), snapshot([1]))).toBe(false)
  cache.setIdentity(alice)
  expect(cache.put(key('c1'), snapshot([1]))).toBe(true)
  cache.saveScroll(key('c1'), { atBottom: false, anchorId: 'm1', offset: 12 })
  expect(cache.get(key('c1', { userId: 'bob', workspaceId: 'w1' }))).toBeNull()
  expect(cache.put(key('c1', { userId: 'bob', workspaceId: 'w1' }), snapshot([1]))).toBe(false)
  cache.setIdentity({ userId: 'alice', workspaceId: 'w2' })
  expect(cache.stats()).toMatchObject({ entries: 0, bytes: 0, scrolls: 0 })
  cache.setIdentity(alice)
  expect(cache.get(key('c1'))).toBeNull()
  cache.setIdentity(null)
  expect(cache.put(key('c1'), snapshot([1]))).toBe(false)
})

test('discards a late write from before an identity change', () => {
  const cache = createTranscriptCache(limits)
  cache.setIdentity(alice)
  const started = cache.generation()
  cache.setIdentity({ userId: 'bob', workspaceId: 'w1' })
  cache.setIdentity(alice)
  expect(cache.put(key('c1'), snapshot([1]), started)).toBe(false)
  expect(cache.get(key('c1'))).toBeNull()
})

test('bounds entries, retained items and bytes, evicting the least recently used', () => {
  const cache = createTranscriptCache(limits)
  cache.setIdentity(alice)
  cache.put(key('a'), snapshot([1, 2, 3, 4, 5, 6]))
  const a = cache.get(key('a'))!
  expect(a.items).toEqual([1, 2, 3, 4])
  expect(a).toMatchObject({ loadedCount: 4, isDone: false })
  cache.put(key('b'), snapshot([1]))
  cache.put(key('c'), snapshot([1]))
  cache.get(key('a'))
  cache.put(key('d'), snapshot([1]))
  expect(cache.get(key('b'))).toBeNull()
  expect(cache.get(key('a'))).not.toBeNull()
  expect(cache.stats().entries).toBe(3)
  expect(cache.put(key('huge'), snapshot(['x'.repeat(6_000)]))).toBe(false)
  expect(cache.get(key('huge'))).toBeNull()
  cache.put(key('e'), snapshot(['x'.repeat(2_000)]))
  cache.put(key('f'), snapshot(['x'.repeat(2_000)]))
  expect(cache.stats().bytes).toBeLessThanOrEqual(limits.maxBytes)
})

test('evicts known-unavailable conversations with their scroll, and keeps scroll across write-backs', () => {
  const cache = createTranscriptCache(limits)
  cache.setIdentity(alice)
  cache.put(key('c1'), snapshot([1]))
  cache.saveScroll(key('c1'), { atBottom: false, anchorId: 'm1', offset: 4 })
  cache.put(key('c1'), snapshot([1, 2]))
  expect(cache.scroll(key('c1'))).toEqual({ atBottom: false, anchorId: 'm1', offset: 4 })
  cache.evict(key('c1'))
  expect(cache.get(key('c1'))).toBeNull()
  expect(cache.scroll(key('c1'))).toBeNull()
})

test('does not restore a stale snapshot', () => {
  let now = 0
  const cache = createTranscriptCache(limits, () => now)
  cache.setIdentity(alice)
  cache.put(key('c1'), snapshot([1]))
  now = limits.maxAgeMs + 1
  expect(cache.get(key('c1'))).toBeNull()
})

test('a restored snapshot sets the live first page size within the backend cap', () => {
  expect(restoredPageSize(null, 50)).toBe(50)
  expect(restoredPageSize({ loadedCount: 20 }, 50)).toBe(50)
  expect(restoredPageSize({ loadedCount: 80 }, 50)).toBe(80)
  expect(restoredPageSize({ loadedCount: 300 }, 50)).toBe(100)
})
