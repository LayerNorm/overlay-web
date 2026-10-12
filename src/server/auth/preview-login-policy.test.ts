import assert from 'node:assert/strict'
import test from 'node:test'
import type { AuthSession } from '@/shared/auth/session-types'
import { PREVIEW_WORKOS_CLIENT_ID, previewLoginResponse } from './preview-login-policy'

const secret = 'fixture-preview-secret-at-least-32-characters'
const env = {
  VERCEL_ENV: 'preview', OVERLAY_DEPLOYMENT_ENV: 'preview',
  WORKOS_CLIENT_ID: PREVIEW_WORKOS_CLIENT_ID,
  WORKOS_API_KEY: 'sk_test_fixture',
  NEXT_PUBLIC_APP_URL: 'https://pr-123.preview.getoverlay.io',
  PREVIEW_LOGIN_SECRET: secret, PREVIEW_LOGIN_EMAIL: 'preview@example.test',
  PREVIEW_LOGIN_PASSWORD: 'fixture-password', PREVIEW_LOGIN_USER_ID: 'user_preview_fixture',
}
const session: AuthSession = {
  accessToken: 'fixture-access-token', refreshToken: 'fixture-refresh-token', expiresAt: 1,
  user: { id: env.PREVIEW_LOGIN_USER_ID, email: env.PREVIEW_LOGIN_EMAIL, emailVerified: true },
}
function request(provided = secret) {
  return new Request(env.NEXT_PUBLIC_APP_URL + '/api/auth/preview-login', {
    method: 'POST', headers: { 'x-overlay-preview-secret': provided },
  })
}

test('production, staging, wrong WorkOS account and malformed secrets reject before provider access', async () => {
  for (const patch of [
    { VERCEL_ENV: 'production' }, { OVERLAY_DEPLOYMENT_ENV: 'production' },
    { OVERLAY_DEPLOYMENT_ENV: 'staging' }, { WORKOS_CLIENT_ID: 'client_production' },
    { PREVIEW_LOGIN_SECRET: 'short' }, { NEXT_PUBLIC_APP_URL: 'https://staging.getoverlay.io' },
    { PREVIEW_LOGIN_PASSWORD: '' }, { WORKOS_API_KEY: '' },
  ]) {
    const forbidden = async () => { throw new Error('must not call dependencies') }
    const response = await previewLoginResponse(request(), { ...env, ...patch }, {
      authenticate: forbidden, saveSession: forbidden, rateLimit: forbidden,
    })
    assert.equal(response.status, 404)
  }
})

test('missing or incorrect secret rejects before authentication', async () => {
  let calls = 0
  for (const value of ['', 'wrong', secret + 'x']) {
    const response = await previewLoginResponse(request(value), env, {
      authenticate: async () => { calls++; return session },
      saveSession: async () => { calls++ }, rateLimit: async () => { calls++; return null },
    })
    assert.equal(response.status, 404)
  }
  assert.equal(calls, 0)
})

test('preview uses configured identity, retains real tokens in the session and never returns them', async () => {
  let saved: AuthSession | undefined
  const response = await previewLoginResponse(request(), env, {
    authenticate: async (email, password) => {
      assert.equal(email, env.PREVIEW_LOGIN_EMAIL)
      assert.equal(password, env.PREVIEW_LOGIN_PASSWORD)
      return session
    },
    saveSession: async (value) => { saved = value }, rateLimit: async () => null,
  })
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('Cache-Control'), 'no-store')
  assert.deepEqual(await response.json(), { success: true, userId: env.PREVIEW_LOGIN_USER_ID })
  assert.equal(saved, session)
})

test('a mismatched provider identity cannot create a session', async () => {
  let saved = false
  const response = await previewLoginResponse(request(), env, {
    authenticate: async () => ({ ...session, user: { ...session.user, id: 'user_other' } }),
    saveSession: async () => { saved = true }, rateLimit: async () => null,
  })
  assert.equal(response.status, 404)
  assert.equal(saved, false)
})
