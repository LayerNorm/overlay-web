import assert from 'node:assert/strict'
import test, { type TestContext } from 'node:test'
import {
  ChatTransportHttpError,
  createChatDiagnosticFetch,
} from './direct-chat-transport'

function browser(t: TestContext) {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'window')
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { location: new URL('https://app.example/w/team-a/work') },
  })
  t.after(() => {
    if (original) Object.defineProperty(globalThis, 'window', original)
    else Reflect.deleteProperty(globalThis, 'window')
  })
  t.mock.method(console, 'error', () => {})
}

test('chat refreshes a rejected browser session once without changing the turn or stream', async (t) => {
  browser(t)
  let refreshes = 0
  t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL) => {
    assert.equal(input, '/api/auth/session')
    refreshes++
    return Response.json({ authenticated: true, user: { id: 'qa', email: 'qa@example.com' } })
  })
  const attempts: RequestInit[] = []
  const stream = new Response('data: [DONE]\n\n')
  const diagnosticFetch = createChatDiagnosticFetch(async (_input, init) => {
    attempts.push(init!)
    return attempts.length === 1
      ? Response.json({ error: 'Unauthorized' }, { status: 401, headers: { 'WWW-Authenticate': 'Bearer' } })
      : stream
  })
  const init = {
    method: 'POST',
    credentials: 'same-origin' as const,
    headers: { 'Idempotency-Key': 'turn-1', 'x-request-id': 'request-1' },
    body: JSON.stringify({ turnId: 'turn-1', messages: [] }),
  }
  assert.equal(await diagnosticFetch('/api/v1/conversations/act', init), stream)
  assert.equal(stream.bodyUsed, false)
  assert.equal(refreshes, 1)
  assert.equal(attempts.length, 2)
  assert.equal(attempts[0], attempts[1])
  assert.equal(attempts[1].body, init.body)
  const headers = new Headers(attempts[1].headers)
  assert.equal(headers.get('Idempotency-Key'), 'turn-1')
  assert.equal(headers.get('x-request-id'), 'request-1')
  assert.equal(headers.get('x-overlay-route-workspace'), 'handle:team-a')
})

test('chat leaves upstream failures alone and bounds repeated auth rejections', async (t) => {
  browser(t)
  let refreshes = 0
  t.mock.method(globalThis, 'fetch', async () => {
    refreshes++
    return Response.json({ authenticated: true, user: { id: 'qa', email: 'qa@example.com' } })
  })
  for (const status of [401, 403, 429, 502]) {
    let attempts = 0
    const diagnosticFetch = createChatDiagnosticFetch(async () => {
      attempts++
      return Response.json({ error: 'Rejected' }, { status })
    })
    await assert.rejects(diagnosticFetch('/api/v1/conversations/act', { method: 'POST', body: '{}' }),
      (error: unknown) => error instanceof ChatTransportHttpError && error.status === status)
    assert.equal(attempts, 1)
    assert.equal(refreshes, 0)
  }
  let attempts = 0
  const diagnosticFetch = createChatDiagnosticFetch(async () => {
    attempts++
    return Response.json({ error: 'Unauthorized' }, { status: 401, headers: { 'WWW-Authenticate': 'Bearer' } })
  })
  await assert.rejects(diagnosticFetch('/api/v1/conversations/act', { method: 'POST', body: '{}' }),
    (error: unknown) => error instanceof ChatTransportHttpError && error.status === 401)
  assert.equal(attempts, 2)
  assert.equal(refreshes, 1)
})

test('preserves structured upstream error details for browser diagnostics', async () => {
  const originalConsoleError = console.error
  console.error = () => {}
  try {
    const diagnosticFetch = createChatDiagnosticFetch(async () => new Response(JSON.stringify({
      code: 'provider_upstream_failed',
      error: 'Provider rejected the request',
      fallbackSafe: false,
      phase: 'upstream',
      requestId: 'request-456',
    }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    }))

    await assert.rejects(
      diagnosticFetch('/api/v1/conversations/act', {
        headers: { 'x-request-id': 'request-456' },
      }),
      (error: unknown) => {
        assert.ok(error instanceof ChatTransportHttpError)
        assert.equal(error.status, 502)
        assert.equal(error.phase, 'upstream')
        assert.equal(error.fallbackSafe, false)
        assert.equal(error.requestId, 'request-456')
        assert.equal(error.message, 'Provider rejected the request')
        return true
      },
    )
  } finally {
    console.error = originalConsoleError
  }
})
