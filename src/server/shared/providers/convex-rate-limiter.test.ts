import assert from 'node:assert/strict'
import test from 'node:test'
import { lazyConvex as convex } from '@/server/database/lazy-convex'
import { ConvexRateLimiter } from './convex-rate-limiter'

test('distributed limiter failure denies owner-funded capacity buckets', async (t) => {
  const originalSecret = process.env.INTERNAL_API_SECRET
  process.env.INTERNAL_API_SECRET = 'rate-limit-test-secret'
  t.after(() => {
    if (originalSecret === undefined) delete process.env.INTERNAL_API_SECRET
    else process.env.INTERNAL_API_SECRET = originalSecret
  })
  t.mock.method(convex, 'mutation', async () => {
    throw new Error('distributed limiter unavailable')
  })

  const result = await new ConvexRateLimiter().check('POST /api/v1/generate-image', [
    {
      bucket: 'owner-funded:global',
      key: 'global',
      limit: 100,
      windowMs: 60_000,
    },
  ])

  assert.equal(result.allowed, false)
  assert.equal(result.retryAfterSeconds, 60)
})

test('distributed limiter failure retains local fallback for non-financial traffic', async (t) => {
  const originalSecret = process.env.INTERNAL_API_SECRET
  process.env.INTERNAL_API_SECRET = 'rate-limit-test-secret'
  t.after(() => {
    if (originalSecret === undefined) delete process.env.INTERNAL_API_SECRET
    else process.env.INTERNAL_API_SECRET = originalSecret
  })
  t.mock.method(convex, 'mutation', async () => {
    throw new Error('distributed limiter unavailable')
  })

  const result = await new ConvexRateLimiter().check('GET /api/v1/files', [
    {
      bucket: 'files:user',
      key: 'user_1',
      limit: 10,
      windowMs: 60_000,
    },
  ])

  assert.equal(result.allowed, true)
})
