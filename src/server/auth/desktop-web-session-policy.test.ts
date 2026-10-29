import assert from 'node:assert/strict'
import test from 'node:test'
import type { AuthSession } from '@/shared/auth/session-types'
import {
  DESKTOP_WEB_SESSION_VERIFIER_HEADER,
  desktopWebSessionResponse,
  parseTransferredSession,
} from './desktop-web-session-policy'

const token = 'a'.repeat(32)
const verifier = 'v'.repeat(43)
const payload = JSON.stringify({
  userId: 'user_fixture', email: 'person@example.test', firstName: 'Ada', lastName: '',
  accessToken: 'fixture-access-token', refreshToken: 'fixture-refresh-token',
  expiresAt: Date.now() + 60_000, emailVerified: true,
})

function request(query = `token=${token}`, header: string | null = verifier) {
  return new Request(`https://overlay.example.test/auth/desktop/complete?${query}`, {
    headers: header === null ? {} : { [DESKTOP_WEB_SESSION_VERIFIER_HEADER]: header },
  })
}

const forbidden = async (): Promise<never> => { throw new Error('must not call dependencies') }

test('a missing verifier or malformed token fails before touching the token store', async () => {
  for (const req of [request(undefined, null), request('token=not-hex'), request(undefined, 'short')]) {
    const response = await desktopWebSessionResponse(req, {
      consumeToken: forbidden, saveSession: forbidden, rateLimit: async () => null,
    })
    assert.equal(response.status, 303)
    assert.equal(new URL(response.headers.get('location')!).pathname, '/auth/sign-in')
  }
})

test('a rate-limited request is returned as is', async () => {
  const limited = new Response(null, { status: 429 })
  const response = await desktopWebSessionResponse(request(), {
    consumeToken: forbidden, saveSession: forbidden, rateLimit: async () => limited,
  })
  assert.equal(response, limited)
})

test('a rejected or already used token signs nobody in', async () => {
  const response = await desktopWebSessionResponse(request(), {
    consumeToken: async () => null, saveSession: forbidden, rateLimit: async () => null,
  })
  assert.equal(new URL(response.headers.get('location')!).search, '?error=desktop_sign_in_failed')
})

test('a valid token saves the session and redirects into the app', async () => {
  const consumed: Array<[string, string]> = []
  let saved: AuthSession | null = null
  const response = await desktopWebSessionResponse(request(), {
    consumeToken: async (t, v) => { consumed.push([t, v]); return payload },
    saveSession: async (session) => { saved = session },
    rateLimit: async () => null,
  })
  assert.deepEqual(consumed, [[token, verifier]])
  assert.equal(response.status, 303)
  assert.equal(response.headers.get('location'), 'https://overlay.example.test/app')
  assert.equal(response.headers.get('cache-control'), 'no-store, max-age=0')
  assert.equal(saved!.user.id, 'user_fixture')
  assert.equal(saved!.user.emailVerified, true)
})

test('transferred payloads need tokens, identity and a future expiry', () => {
  const base = JSON.parse(payload) as Record<string, unknown>
  assert.ok(parseTransferredSession(payload))
  assert.equal(parseTransferredSession('not json'), null)
  for (const key of ['accessToken', 'refreshToken', 'userId', 'email']) {
    assert.equal(parseTransferredSession(JSON.stringify({ ...base, [key]: '' })), null)
  }
  assert.equal(parseTransferredSession(JSON.stringify({ ...base, expiresAt: Date.now() - 1 })), null)
  assert.equal(parseTransferredSession(JSON.stringify({ ...base, emailVerified: undefined }))!.user.emailVerified, false)
})
