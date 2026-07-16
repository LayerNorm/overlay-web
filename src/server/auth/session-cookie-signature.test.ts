import 'server-only'

import { createHmac } from 'node:crypto'
import test from 'node:test'
import assert from 'node:assert/strict'

test('hasValidSessionCookieSignature accepts valid cookies and rejects tampering', async () => {
  process.env.SESSION_SECRET = 'test-session-secret-0123456789abcdef'

  const { hasValidSessionCookieSignature } = await import(
    new URL(`./session-cookie-signature.ts?test=${Date.now()}`, import.meta.url).href
  )

  const payload = 'encrypted.session.payload'
  const signature = createHmac('sha256', process.env.SESSION_SECRET).update(payload).digest('hex')
  const validCookie = `${payload}.${signature}`

  assert.equal(await hasValidSessionCookieSignature(validCookie), true)
  assert.equal(await hasValidSessionCookieSignature(`${payload}.deadbeef`), false)
  assert.equal(await hasValidSessionCookieSignature(`tampered.${signature}`), false)
  assert.equal(await hasValidSessionCookieSignature('not-a-cookie'), false)
  assert.equal(await hasValidSessionCookieSignature(''), false)
})

test('hasValidSessionCookieSignature accepts the previous key during rotation overlap', async () => {
  const previous = 'previous-session-secret-0123456789abcdef'
  process.env.SESSION_SECRET = 'current-session-secret-0123456789abcdef'
  process.env.SESSION_SECRET_PREVIOUS = previous
  const { hasValidSessionCookieSignature } = await import(
    new URL(`./session-cookie-signature.ts?rotation=${Date.now()}`, import.meta.url).href
  )
  const payload = 'rotating.session.payload'
  const signature = createHmac('sha256', previous).update(payload).digest('hex')
  assert.equal(await hasValidSessionCookieSignature(`${payload}.${signature}`), true)
  delete process.env.SESSION_SECRET_PREVIOUS
})
