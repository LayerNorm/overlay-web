import test from 'node:test'
import assert from 'node:assert/strict'

test('sanitizeSentryEvent strips sensitive headers and cookies', async () => {
  const { sanitizeSentryEvent } = await loadSanitizer()
  const event = {
    request: {
      headers: {
        Authorization: 'Bearer secret-token',
        cookie: 'overlay_session=abc',
        'x-api-key': 'sk-secret-key',
        'content-type': 'application/json',
      },
      cookies: { overlay_session: 'abc' },
      data: {
        prompt: 'use sk-test-secret',
      },
      url: 'https://example.com/callback?token=abc123&safe=1',
    },
    message: 'jwt eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.c2lnbmF0dXJlMTIz',
  }

  const sanitized = sanitizeSentryEvent(event)

  assert.deepEqual(sanitized.request?.headers, {
    'content-type': 'application/json',
  })
  assert.equal(sanitized.request?.cookies, '[REDACTED]')
  assert.equal(sanitized.request?.data, '[REDACTED]')
  assert.equal(sanitized.request?.url, 'https://example.com/callback?token=%5BREDACTED%5D&safe=1')
  assert.equal(sanitized.message, '[REDACTED]')
})

test('sanitizeSentryEvent redacts nested strings without mutating the original event', async () => {
  const { sanitizeSentryEvent } = await loadSanitizer()
  const original = {
    exception: {
      values: [
        {
          value: 'provider key pk_live_1234567890',
        },
      ],
    },
    extra: {
      nested: {
        token: '0123456789abcdef0123456789abcdef01234567',
      },
    },
    breadcrumbs: [
      {
        message: 'rk_live_1234567890',
      },
    ],
  }

  const sanitized = sanitizeSentryEvent(original)

  assert.equal(original.exception.values[0]?.value, 'provider key pk_live_1234567890')
  assert.equal(sanitized.exception.values[0]?.value, '[REDACTED]')
  assert.equal(sanitized.extra.nested.token, '[REDACTED]')
  assert.equal(sanitized.breadcrumbs[0]?.message, '[REDACTED]')
})

test('sanitizeSentryEvent removes identity and prompt fields before vendor delivery', async () => {
  const { sanitizeSentryEvent } = await loadSanitizer()
  const sanitized = sanitizeSentryEvent({
    extra: {
      documentName: 'private.pdf',
      prompt: 'summarize this private document',
    },
    user: {
      email: 'person@example.com',
      id: 'user_1',
      username: 'Person Name',
    },
  })

  assert.deepEqual(sanitized.extra, {
    documentName: '[REDACTED]',
    prompt: '[REDACTED]',
  })
  assert.deepEqual(sanitized.user, {
    email: '[REDACTED]',
    id: 'user_1',
    username: '[REDACTED]',
  })
})

async function loadSanitizer() {
  return await import(new URL('./sentry-sanitize.ts', import.meta.url).href)
}
