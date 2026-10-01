import { afterEach, beforeAll, describe, expect, test, vi } from 'vitest'
import { convexTest } from 'convex-test'
import { makeFunctionReference } from 'convex/server'
import schema from './schema'

// Contract for the Chat SDK StateAdapter backing store. Semantics mirror
// @chat-adapter/state-pg: expired rows are invisible and replaceable,
// setIfNotExists and locks are atomic, lists/queues keep insertion order.

const modules = import.meta.glob('./**/*.ts')
const secret = 'surface-chat-state-secret'

beforeAll(() => { process.env.INTERNAL_API_SECRET = secret })
afterEach(() => { vi.useRealTimers() })

const q = (name: string) => makeFunctionReference<'query'>(`surfaces/chatState:${name}`)
const m = (name: string) => makeFunctionReference<'mutation'>(`surfaces/chatState:${name}`)

describe('surfaces/chatState', () => {
  test('rejects callers without the server secret', async () => {
    const convex = convexTest(schema, modules)
    await expect(convex.query(q('get'), { serverSecret: 'wrong', key: 'k' })).rejects.toThrow(/Unauthorized/)
    await expect(convex.mutation(m('set'), { serverSecret: 'wrong', key: 'k', value: '1' })).rejects.toThrow(/Unauthorized/)
  })

  test('cache set/get/delete with TTL expiry and replacement', async () => {
    vi.useFakeTimers({ now: 1_000_000 })
    const convex = convexTest(schema, modules)
    const args = { serverSecret: secret }
    expect(await convex.query(q('get'), { ...args, key: 'install:T1' })).toBeNull()

    await convex.mutation(m('set'), { ...args, key: 'install:T1', value: '{"token":"a"}' })
    await convex.mutation(m('set'), { ...args, key: 'install:T1', value: '{"token":"b"}' })
    expect(await convex.query(q('get'), { ...args, key: 'install:T1' })).toBe('{"token":"b"}')

    await convex.mutation(m('set'), { ...args, key: 'dedupe:e1', value: 'true', ttlMs: 1_000 })
    expect(await convex.query(q('get'), { ...args, key: 'dedupe:e1' })).toBe('true')
    vi.setSystemTime(1_000_000 + 1_001)
    expect(await convex.query(q('get'), { ...args, key: 'dedupe:e1' })).toBeNull()

    await convex.mutation(m('remove'), { ...args, key: 'install:T1' })
    expect(await convex.query(q('get'), { ...args, key: 'install:T1' })).toBeNull()
  })

  test('setIfNotExists only wins once per live key', async () => {
    vi.useFakeTimers({ now: 2_000_000 })
    const convex = convexTest(schema, modules)
    const args = { serverSecret: secret, key: 'event:Ev1', value: '1', ttlMs: 500 }
    expect(await convex.mutation(m('setIfNotExists'), args)).toBe(true)
    expect(await convex.mutation(m('setIfNotExists'), args)).toBe(false)
    // An expired key can be claimed again.
    vi.setSystemTime(2_000_000 + 501)
    expect(await convex.mutation(m('setIfNotExists'), args)).toBe(true)
  })

  test('locks are exclusive, token-checked, extendable, and force-releasable', async () => {
    vi.useFakeTimers({ now: 3_000_000 })
    const convex = convexTest(schema, modules)
    const base = { serverSecret: secret, threadId: 'slack:C1:1.0' }
    const lock = await convex.mutation(m('acquireLock'), { ...base, token: 'a', ttlMs: 1_000 })
    expect(lock).toEqual({ threadId: base.threadId, token: 'a', expiresAt: 3_001_000 })
    expect(await convex.mutation(m('acquireLock'), { ...base, token: 'b', ttlMs: 1_000 })).toBeNull()

    // A stale holder cannot release or extend someone else's lock.
    await convex.mutation(m('releaseLock'), { ...base, token: 'b' })
    expect(await convex.mutation(m('extendLock'), { ...base, token: 'b', ttlMs: 5_000 })).toBe(false)
    expect(await convex.mutation(m('extendLock'), { ...base, token: 'a', ttlMs: 5_000 })).toBe(true)

    vi.setSystemTime(3_000_000 + 2_000)
    expect(await convex.mutation(m('acquireLock'), { ...base, token: 'c', ttlMs: 1_000 })).toBeNull()

    await convex.mutation(m('releaseLock'), base)
    expect(await convex.mutation(m('acquireLock'), { ...base, token: 'c', ttlMs: 1_000 })).not.toBeNull()

    // After expiry the lock can be taken over and cannot be extended.
    vi.setSystemTime(3_000_000 + 10_000)
    expect(await convex.mutation(m('extendLock'), { ...base, token: 'c', ttlMs: 1_000 })).toBe(false)
    expect(await convex.mutation(m('acquireLock'), { ...base, token: 'd', ttlMs: 1_000 })).not.toBeNull()
  })

  test('lists keep insertion order, trim to maxLength, and refresh TTL', async () => {
    vi.useFakeTimers({ now: 4_000_000 })
    const convex = convexTest(schema, modules)
    const base = { serverSecret: secret, key: 'history:T1' }
    for (const value of ['1', '2', '3', '4']) {
      await convex.mutation(m('appendToList'), { ...base, value, maxLength: 3, ttlMs: 1_000 })
      vi.setSystemTime(Date.now() + 600)
    }
    // Each append refreshed the TTL, so earlier entries are still live.
    expect(await convex.query(q('getList'), base)).toEqual(['2', '3', '4'])
    vi.setSystemTime(Date.now() + 1_000)
    expect(await convex.query(q('getList'), base)).toEqual([])
  })

  test('queues are FIFO, bounded, and skip expired entries', async () => {
    vi.useFakeTimers({ now: 5_000_000 })
    const convex = convexTest(schema, modules)
    const base = { serverSecret: secret, threadId: 'slack:C1:2.0' }
    const future = 5_000_000 + 60_000
    expect(await convex.mutation(m('enqueue'), { ...base, value: 'a', entryExpiresAt: 5_000_000 + 100, maxSize: 10 })).toBe(1)
    expect(await convex.mutation(m('enqueue'), { ...base, value: 'b', entryExpiresAt: future, maxSize: 10 })).toBe(2)
    expect(await convex.mutation(m('enqueue'), { ...base, value: 'c', entryExpiresAt: future, maxSize: 10 })).toBe(3)
    // Over capacity the oldest entry is dropped.
    expect(await convex.mutation(m('enqueue'), { ...base, value: 'd', entryExpiresAt: future, maxSize: 3 })).toBe(3)

    vi.setSystemTime(5_000_000 + 200)
    expect(await convex.query(q('queueDepth'), base)).toBe(3)
    expect(await convex.mutation(m('dequeue'), base)).toBe('b')
    expect(await convex.mutation(m('dequeue'), base)).toBe('c')
    expect(await convex.mutation(m('dequeue'), base)).toBe('d')
    expect(await convex.mutation(m('dequeue'), base)).toBeNull()
  })

  test('subscriptions are idempotent', async () => {
    const convex = convexTest(schema, modules)
    const base = { serverSecret: secret, threadId: 'slack:C1:3.0' }
    expect(await convex.query(q('isSubscribed'), base)).toBe(false)
    await convex.mutation(m('subscribe'), base)
    await convex.mutation(m('subscribe'), base)
    expect(await convex.query(q('isSubscribed'), base)).toBe(true)
    await convex.mutation(m('unsubscribe'), base)
    expect(await convex.query(q('isSubscribed'), base)).toBe(false)
  })

  test('the expiry sweep removes only expired rows', async () => {
    vi.useFakeTimers({ now: 6_000_000 })
    const convex = convexTest(schema, modules)
    const args = { serverSecret: secret }
    await convex.mutation(m('set'), { ...args, key: 'keep', value: '1' })
    await convex.mutation(m('set'), { ...args, key: 'gone', value: '1', ttlMs: 10 })
    vi.setSystemTime(6_000_000 + 20)
    const pruned = await convex.mutation(makeFunctionReference<'mutation'>('surfaces/chatState:pruneExpired'), {})
    expect(pruned).toBe(1)
    expect(await convex.query(q('get'), { ...args, key: 'keep' })).toBe('1')
  })
})
