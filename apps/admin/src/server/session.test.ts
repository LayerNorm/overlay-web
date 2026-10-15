import assert from 'node:assert/strict'
import test from 'node:test'

process.env.ADMIN_SESSION_SECRET ??= 'test-session-secret'

// Imports stay static: env is read lazily inside each function.
import {
  hasRecentSignIn,
  openPayload,
  openSession,
  sealPayload,
  sessionStatus,
  SESSION_ABSOLUTE_TTL_MS,
  SESSION_IDLE_TTL_MS,
  RECENT_SIGN_IN_WINDOW_MS,
} from './session'

test('sealed payloads roundtrip and reject tampering', () => {
  const sealed = sealPayload({ id: 'user_1', roles: ['admin'] })
  assert.deepEqual(openPayload(sealed), { id: 'user_1', roles: ['admin'] })

  const [payload, sig] = sealed.split('.')
  assert.equal(openPayload(`${payload}x.${sig}`), null)
  assert.equal(openPayload(`${payload}.${sig}x`), null)
  assert.equal(openPayload('garbage'), null)
  assert.equal(openPayload(`${payload}.`), null)
})

test('session opens only complete sessions', () => {
  const session = freshSession()
  assert.deepEqual(openSession(sealPayload(session)), session)
  assert.equal(openSession(sealPayload({ ...session, accessToken: '' })), null)
  assert.equal(openSession(undefined), null)
})

test('session status covers absolute and idle expiry', () => {
  const now = Date.now()
  const session = freshSession(now)
  assert.equal(sessionStatus(session, now), 'active')
  assert.equal(sessionStatus(session, now + SESSION_IDLE_TTL_MS + 1), 'idle_expired')
  assert.equal(
    sessionStatus({ ...session, signedInAt: now - SESSION_ABSOLUTE_TTL_MS - 1 }, now),
    'expired',
  )
})

test('recent sign-in window is enforced', () => {
  const now = Date.now()
  const session = freshSession(now)
  assert.equal(hasRecentSignIn(session, now), true)
  assert.equal(hasRecentSignIn(session, now + RECENT_SIGN_IN_WINDOW_MS + 1), false)
})

function freshSession(now = Date.now()) {
  return {
    accessToken: `header.${Buffer.from(JSON.stringify({ auth_time: Math.floor(now / 1000) })).toString('base64url')}.sig`,
    lastActiveAt: now,
    refreshToken: null,
    signedInAt: now,
    user: { email: 'dev@layernorm.ai', firstName: 'Dev', id: 'user_1', lastName: 'L' },
  }
}
