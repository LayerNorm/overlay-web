import assert from 'node:assert/strict'
import test from 'node:test'

process.env.ADMIN_SESSION_SECRET ??= 'test-session-secret'
process.env.ADMIN_ALLOWED_USER_IDS = 'user_allowed,user_admin'

import type { AdministrativePrincipal } from './admin/AdministrativeRepository'
import { sealPayload } from './session'
import { resolveOperator } from './operator'

const ACTIVE_PRINCIPAL: AdministrativePrincipal = {
  createdAt: 1,
  role: 'admin' as const,
  updatedAt: 1,
  userId: 'user_admin',
}

test('missing or invalid sessions resolve to anonymous', async () => {
  assert.deepEqual(await resolveOperator(undefined), { kind: 'anonymous', reason: 'missing' })
  assert.deepEqual(await resolveOperator('tampered'), { kind: 'anonymous', reason: 'invalid' })
})

test('a user outside ADMIN_ALLOWED_USER_IDS is denied', async () => {
  const cookie = sealPayload(sessionFor('user_stranger'))
  const resolution = await resolveOperator(cookie, { getPrincipal: principalOf(null) })
  assert.deepEqual(resolution, { kind: 'denied', reason: 'not_allowlisted' })
})

test('an allowlisted user without an active principal is denied', async () => {
  const cookie = sealPayload(sessionFor('user_allowed'))
  assert.deepEqual(
    await resolveOperator(cookie, { getPrincipal: principalOf(null) }),
    { kind: 'denied', reason: 'not_operator' },
  )
})

test('a revoked principal loses operator access', async () => {
  const cookie = sealPayload(sessionFor('user_admin'))
  const revoked = { ...ACTIVE_PRINCIPAL, revokedAt: Date.now() }
  assert.deepEqual(
    await resolveOperator(cookie, { getPrincipal: principalOf(revoked) }),
    { kind: 'denied', reason: 'not_operator' },
  )
})

test('an active principal resolves to an operator', async () => {
  const session = sessionFor('user_admin')
  const resolution = await resolveOperator(sealPayload(session), {
    getPrincipal: principalOf(ACTIVE_PRINCIPAL),
  })
  assert.equal(resolution.kind, 'operator')
  if (resolution.kind === 'operator') {
    assert.equal(resolution.principal.role, 'admin')
    assert.equal(resolution.user.id, 'user_admin')
  }
})

function principalOf(value: AdministrativePrincipal | null) {
  return async () => value
}

function sessionFor(userId: string) {
  const now = Date.now()
  return {
    // A JWT-shaped token with a distant expiry skips the WorkOS refresh path.
    accessToken: `${b64({ alg: 'none' })}.${b64({ exp: Math.floor(now / 1000) + 3600 })}.sig`,
    lastActiveAt: now,
    refreshToken: null,
    signedInAt: now,
    user: { email: `${userId}@layernorm.ai`, firstName: null, id: userId, lastName: null },
  }
}

function b64(value: unknown) {
  return Buffer.from(JSON.stringify(value)).toString('base64url')
}
