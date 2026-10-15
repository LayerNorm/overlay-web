import assert from 'node:assert/strict'
import test from 'node:test'
import { NextRequest } from 'next/server'
import { safeReturnTo } from './auth-redirect'
import { operatorCapabilities } from './operator-permissions'
import { hasRecentSignIn, tokenAuthenticationTime } from './session'
import { GET as signIn } from '../app/auth/sign-in/route'

process.env.ADMIN_SESSION_SECRET = 'review-test-session-secret'
process.env.WORKOS_CLIENT_ID = 'client_test_only'
process.env.WORKOS_API_KEY = 'sk_test_only'

test('return destinations stay on the admin origin', () => {
  for (const value of ['//evil.invalid', '/\\evil.invalid', 'https://evil.invalid', '', null]) {
    assert.equal(safeReturnTo(value, 'https://admin.example.invalid'), '/')
  }
  assert.equal(safeReturnTo('/?section=roles#editor', 'https://admin.example.invalid'), '/?section=roles#editor')
})

test('every operator sign-in requests a fresh WorkOS challenge', async () => {
  const result = await signIn(new NextRequest('https://admin.example.invalid/auth/sign-in?reauth=1'))
  const url = new URL(result.headers.get('location')!)
  assert.equal(url.searchParams.get('max_age'), '0')
  assert.equal(url.searchParams.get('redirect_uri'), 'https://admin.example.invalid/auth/callback')
})

test('recent sign-in uses auth_time, never the callback or refreshed-token timestamp', () => {
  const now = 1_800_000_000_000
  const session = { accessToken: '', refreshToken: null, signedInAt: now, lastActiveAt: now,
    user: { id: 'user_admin', email: 'review@example.invalid', firstName: null, lastName: null } }
  const token = (seconds: number) => `header.${Buffer.from(JSON.stringify({ auth_time: seconds, iat: now / 1000 })).toString('base64url')}.sig`
  assert.equal(hasRecentSignIn({ ...session, accessToken: token(now / 1000 - 3600) }, now), false)
  assert.equal(hasRecentSignIn({ ...session, accessToken: token(now / 1000 - 60) }, now), true)
  assert.equal(hasRecentSignIn({ ...session, accessToken: token(now / 1000 + 120) }, now), false)
  assert.equal(tokenAuthenticationTime('malformed'), null)
  assert.equal(hasRecentSignIn(session, now), false)
})

test('fresh principals have operator capabilities without customer role assignments', () => {
  const principal = { userId: 'fresh_admin', role: 'admin' as const, createdAt: 1, updatedAt: 1 }
  assert.ok(operatorCapabilities(principal).includes('roles.manage'))
  assert.ok(operatorCapabilities({ ...principal, role: 'auditor' }).includes('audit.read'))
  assert.ok(!operatorCapabilities({ ...principal, role: 'auditor' }).includes('roles.manage'))
  assert.ok(operatorCapabilities({ ...principal, role: 'billing_admin' }).includes('usage.read'))
  assert.deepEqual(operatorCapabilities({ ...principal, revokedAt: 0 }), [])
})
