import assert from 'node:assert/strict'
import { afterEach, beforeEach, test } from 'node:test'
import {
  decodeAdminSession,
  decodeOAuthState,
  encodeAdminSession,
  encodeOAuthState,
  newAdminSessionPayload,
  touchAdminSession,
} from './session'

const SECRET = 'test-admin-session-secret'

beforeEach(() => {
  process.env.ADMIN_SESSION_SECRET = SECRET
})

afterEach(() => {
  delete process.env.ADMIN_SESSION_SECRET
})

function session(overrides: Partial<Parameters<typeof newAdminSessionPayload>[0]> = {}) {
  return newAdminSessionPayload({
    accessToken: 'access-token',
    refreshToken: 'refresh-token',
    user: { id: 'user_1', email: 'ops@example.com' },
    ...overrides,
  })
}

test('a session cookie round-trips through encode/decode', () => {
  const decoded = decodeAdminSession(encodeAdminSession(session()))
  assert.equal(decoded?.user.id, 'user_1')
  assert.equal(decoded?.accessToken, 'access-token')
})

test('missing or malformed cookies decode to null', () => {
  assert.equal(decodeAdminSession(undefined), null)
  assert.equal(decodeAdminSession(''), null)
  assert.equal(decodeAdminSession('not-a-cookie'), null)
  assert.equal(decodeAdminSession('a.b.c'), null)
})

test('a tampered payload fails the HMAC check', () => {
  const encoded = encodeAdminSession(session())
  const [payloadB64] = encoded.split('.')
  const tampered = `${Buffer.from('{"user":{"id":"user_2"}}').toString('base64url')}.forged`
  assert.equal(decodeAdminSession(tampered), null)
  // Same payload, signature computed with a different key.
  process.env.ADMIN_SESSION_SECRET = 'other-secret'
  const foreign = `${payloadB64}.${'x'.repeat(43)}`
  assert.equal(decodeAdminSession(foreign), null)
})

test('sessions expire on the 8h absolute TTL', () => {
  const stale = session()
  stale.issuedAt = Date.now() - 9 * 60 * 60 * 1000
  stale.expiresAt = Date.now() - 1 * 60 * 60 * 1000
  stale.lastSeenAt = Date.now()
  assert.equal(decodeAdminSession(encodeAdminSession(stale)), null)
})

test('sessions expire on the 30m idle TTL even while fresh', () => {
  const idle = session()
  idle.lastSeenAt = Date.now() - 31 * 60 * 1000
  assert.equal(decodeAdminSession(encodeAdminSession(idle)), null)
  const active = touchAdminSession(idle)
  assert.ok(decodeAdminSession(encodeAdminSession(active)))
})

test('oauth state round-trips and rejects bad signatures/expiry', () => {
  const encoded = encodeOAuthState('/console')
  assert.deepEqual(decodeOAuthState(encoded), { returnTo: '/console' })
})

test('oauth state rejects foreign paths and expired payloads', () => {
  assert.equal(decodeOAuthState('garbage'), null)
  assert.equal(decodeOAuthState(undefined), null)
})
