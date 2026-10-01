import 'server-only'

import test from 'node:test'
import assert from 'node:assert/strict'

import { getNativeRefreshTokenBucketKey } from './native-refresh-rate-limit.ts'

test('native refresh rate limit bucket is keyed by refresh token hash', () => {
  const tokenA = 'refresh-token-a'
  const tokenB = 'refresh-token-b'

  assert.equal(
    getNativeRefreshTokenBucketKey(tokenA, '203.0.113.10'),
    getNativeRefreshTokenBucketKey(tokenA, '198.51.100.20'),
  )
  assert.notEqual(
    getNativeRefreshTokenBucketKey(tokenA, '203.0.113.10'),
    getNativeRefreshTokenBucketKey(tokenB, '203.0.113.10'),
  )
})

test('native refresh rate limit bucket falls back to client key when token is missing', () => {
  assert.equal(getNativeRefreshTokenBucketKey('', '203.0.113.10'), 'missing:203.0.113.10')
  assert.equal(getNativeRefreshTokenBucketKey(undefined, '203.0.113.10'), 'missing:203.0.113.10')
})
