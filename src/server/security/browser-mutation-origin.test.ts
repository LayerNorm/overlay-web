import assert from 'node:assert/strict'
import test from 'node:test'
import { NextRequest } from 'next/server'
import { rejectCrossSiteBrowserMutation } from './browser-mutation-origin'

function request(method: string, headers: HeadersInit = {}): NextRequest {
  return new NextRequest('https://overlay.test/api/v1/automations', { method, headers })
}

const sessionAuth = {
  accessToken: 'session-token',
  authType: 'session' as const,
  userId: 'user_1',
}

test('rejects cross-site cookie-authenticated mutations', () => {
  const response = rejectCrossSiteBrowserMutation(
    request('POST', { origin: 'https://attacker.test', 'sec-fetch-site': 'cross-site' }),
    sessionAuth,
  )

  assert.equal(response?.status, 403)
})

test('allows same-origin browser mutations and credential-authenticated API callers', () => {
  assert.equal(
    rejectCrossSiteBrowserMutation(
      request('POST', { origin: 'https://overlay.test', 'sec-fetch-site': 'same-origin' }),
      sessionAuth,
    ),
    null,
  )
  assert.equal(
    rejectCrossSiteBrowserMutation(
      request('POST', { origin: 'https://attacker.test', 'sec-fetch-site': 'cross-site' }),
      { ...sessionAuth, authType: 'api-key' },
    ),
    null,
  )
})

test('does not apply origin checks to safe methods', () => {
  assert.equal(
    rejectCrossSiteBrowserMutation(
      request('GET', { origin: 'https://attacker.test', 'sec-fetch-site': 'cross-site' }),
      sessionAuth,
    ),
    null,
  )
})

test('allows the configured public app origin behind a trusted reverse proxy', () => {
  const proxiedRequest = new NextRequest('http://127.0.0.1:3000/api/v1/automations', {
    method: 'POST',
    headers: {
      origin: 'https://overlay.example.com',
      'sec-fetch-site': 'same-origin',
    },
  })

  assert.equal(
    rejectCrossSiteBrowserMutation(
      proxiedRequest,
      sessionAuth,
      'https://overlay.example.com',
    ),
    null,
  )
  assert.equal(
    rejectCrossSiteBrowserMutation(
      new NextRequest(proxiedRequest.url, {
        method: 'POST',
        headers: {
          origin: 'https://attacker.test',
          'sec-fetch-site': 'same-origin',
        },
      }),
      sessionAuth,
      'https://overlay.example.com',
    )?.status,
    403,
  )
})
