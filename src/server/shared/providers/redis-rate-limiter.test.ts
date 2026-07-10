import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import {
  RedisRateLimiter,
  TcpRedisRateLimitStore,
  type RedisRateLimitStore,
} from './redis-rate-limiter'

class MemoryRedisStore implements RedisRateLimitStore {
  private readonly counts = new Map<string, number>()

  async take(key: string, windowMs: number) {
    const count = (this.counts.get(key) ?? 0) + 1
    this.counts.set(key, count)
    return { count, ttlMs: windowMs }
  }
}

test('RedisRateLimiter shares fixed-window state across limiter instances', async () => {
  const store = new MemoryRedisStore()
  const first = new RedisRateLimiter({ failureMode: 'deny', store })
  const second = new RedisRateLimiter({ failureMode: 'deny', store })
  const rule = { bucket: 'shared', key: 'user-1', limit: 2, windowMs: 60_000 }

  assert.equal((await first.check('POST /api/v1/test', [rule])).allowed, true)
  assert.equal((await second.check('POST /api/v1/test', [rule])).allowed, true)
  const blocked = await first.check('POST /api/v1/test', [rule])
  assert.equal(blocked.allowed, false)
  assert.equal(blocked.decisions[0]?.remaining, 0)
})

test('RedisRateLimiter fails closed when the distributed backend is unavailable', async () => {
  const store: RedisRateLimitStore = {
    take: async () => { throw new Error('redis unavailable') },
  }
  const limiter = new RedisRateLimiter({ failureMode: 'deny', store })
  const result = await limiter.check('POST /api/v1/test', [
    { bucket: 'security', key: 'user-1', limit: 2, windowMs: 10_000 },
  ])
  assert.equal(result.allowed, false)
  assert.equal(result.retryAfterSeconds, 10)
})

test('TCP Redis provides a real shared atomic window', {
  skip: process.env.OVERLAY_REDIS_URL ? false : 'OVERLAY_REDIS_URL is required for the Redis integration test',
}, async () => {
  const url = process.env.OVERLAY_REDIS_URL
  if (!url) return
  const prefix = `overlay:test:${randomUUID()}:`
  const firstStore = new TcpRedisRateLimitStore(url, prefix)
  const secondStore = new TcpRedisRateLimitStore(url, prefix)
  const first = new RedisRateLimiter({ failureMode: 'deny', store: firstStore })
  const second = new RedisRateLimiter({ failureMode: 'deny', store: secondStore })
  const rule = { bucket: 'integration', key: 'shared-user', limit: 2, windowMs: 60_000 }
  try {
    assert.equal((await first.check('POST /api/v1/test', [rule])).allowed, true)
    assert.equal((await second.check('POST /api/v1/test', [rule])).allowed, true)
    assert.equal((await first.check('POST /api/v1/test', [rule])).allowed, false)
  } finally {
    await Promise.all([firstStore.close(), secondStore.close()])
  }
})
