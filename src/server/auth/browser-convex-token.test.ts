import assert from 'node:assert/strict'
import test from 'node:test'

process.env.INTERNAL_API_SECRET = 'test-browser-convex-secret'

test('browser Convex tokens mint and verify round-trip', async () => {
  const { mintBrowserConvexAccessToken } = await import('./browser-convex-token')
  const { verifyBrowserConvexAccessToken } = await import('../../../convex/lib/browserConvexToken')

  const token = await mintBrowserConvexAccessToken({ userId: 'user_test_123', ttlMs: 60_000 })
  const claims = await verifyBrowserConvexAccessToken(token)
  assert.ok(claims)
  assert.equal(claims.sub, 'user_test_123')
  assert.equal(claims.iss, 'overlay-browser-convex')
  assert.equal(claims.aud, 'overlay-convex')
})

test('browser Convex tokens reject tampered signatures', async () => {
  const { mintBrowserConvexAccessToken } = await import('./browser-convex-token')
  const { verifyBrowserConvexAccessToken } = await import('../../../convex/lib/browserConvexToken')

  const token = await mintBrowserConvexAccessToken({ userId: 'user_test_123' })
  const parts = token.split('.')
  parts[2] = `${parts[2]?.slice(0, -2) ?? ''}aa`
  const claims = await verifyBrowserConvexAccessToken(parts.join('.'))
  assert.equal(claims, null)
})

test('browser Convex tokens reject subject-less mint attempts', async () => {
  const { mintBrowserConvexAccessToken } = await import('./browser-convex-token')
  await assert.rejects(
    () => mintBrowserConvexAccessToken({ userId: '   ' }),
    /userId is required/,
  )
})
