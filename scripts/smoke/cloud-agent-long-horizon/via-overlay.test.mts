import assert from 'node:assert/strict'
import test, { type TestContext } from 'node:test'
import { messageText, visibleShape, type Message } from './via-overlay.mts'

test('smoke counts and saves the API text parts when content is omitted', () => {
  const message: Message = { id: 'reply', role: 'assistant', createdAt: 1, updatedAt: 2,
    parts: [{ type: 'text', text: '# Result\n\n' }, { type: 'tool-invocation' }, { type: 'text', text: 'Full answer.' }] }
  assert.equal(messageText(message), '# Result\n\nFull answer.')
  assert.equal(visibleShape(message).text, '# Result\n\nFull answer.'.length)
  assert.equal(visibleShape(message).tools, 1)
})

test('smoke respects explicit canonical content and tolerates an absent reply', () => {
  assert.equal(messageText(undefined), '')
  assert.equal(messageText({ id: 'r', role: 'assistant', createdAt: 1, updatedAt: 1, content: 'canonical', parts: [{ type: 'text', text: 'old' }] }), 'canonical')
})

test('long smoke runs refresh an expired API session before retrying the rejected request once', async t => {
  const { OverlayClient } = await import('./via-overlay.mts')
  const calls: string[] = []
  t.mock.method(globalThis, 'fetch', async (input: string | URL | Request, init?: RequestInit) => {
    const path = new URL(typeof input === 'string' || input instanceof URL ? input : input.url).pathname
    calls.push(path)
    if (calls.length === 1) return Response.json({ error: 'Unauthorized' }, { status: 401 })
    if (path === '/api/auth/session') return Response.json({ authenticated: true }, { headers: { 'set-cookie': 'overlay_session=refreshed; HttpOnly' } })
    assert.match(new Headers(init?.headers).get('cookie') ?? '', /overlay_session=refreshed/)
    return Response.json({ success: true })
  })
  const client = new OverlayClient('http://localhost:3000')
  assert.deepEqual(await client.ok('POST', '/api/v1/conversations/message', { content: 'fixture' }), { success: true })
  assert.deepEqual(calls, ['/api/v1/conversations/message', '/api/auth/session', '/api/v1/conversations/message'])
})

test('rate limit errors retain the server cooldown without retrying a mutation', async t => {
  const { OverlayClient, OverlaySmokeHttpError } = await import('./via-overlay.mts')
  let requests = 0
  t.mock.method(globalThis, 'fetch', async () => { requests++; return Response.json({ error: 'Too many requests', retryAfterSeconds: 60 }, { status: 429, headers: { 'retry-after': '276' } }) })
  const client = new OverlayClient('http://localhost:3000')
  await assert.rejects(client.ok('POST', '/api/v1/conversations/message', { content: 'fixture' }), (error: unknown) => {
    assert.ok(error instanceof OverlaySmokeHttpError)
    assert.equal(error.status, 429)
    assert.equal(error.retryAfterMs, 276000)
    return true
  })
  assert.equal(requests, 1)
})

async function mockSmoke(t: TestContext, hardLimitMin: string, rateLimited: boolean) {
  const { runViaOverlay } = await import('./via-overlay.mts')
  const oldCookie = process.env.OVERLAY_SESSION_COOKIE
  process.env.OVERLAY_SESSION_COOKIE = 'synthetic-test-session'
  t.after(() => { if (oldCookie === undefined) delete process.env.OVERLAY_SESSION_COOKIE; else process.env.OVERLAY_SESSION_COOKIE = oldCookie })
  let now = 100000
  const calls: Array<{ method: string; path: string; at: number }> = []
  t.mock.method(Date, 'now', () => now)
  t.mock.method(globalThis, 'setTimeout', (callback: () => void, delay = 0) => {
    now += delay
    queueMicrotask(callback)
    return { unref() {} }
  })
  let reads = 0
  t.mock.method(globalThis, 'fetch', async (input: string | URL | Request, options?: RequestInit) => {
    const path = new URL(typeof input === 'string' || input instanceof URL ? input : input.url).pathname
    const method = options?.method ?? 'GET'
    calls.push({ path, method, at: now })
    if (path === '/api/auth/convex-token') return Response.json({ token: 'fixture' })
    if (path === '/api/v1/provider-accounts') return Response.json({ data: [{ id: 'account', provider: 'claude-code', method: 'subscription', status: 'active' }] })
    if (path === '/api/v1/agents' && method === 'POST') return Response.json({ agent: { id: 'agent', principalId: 'principal' } })
    if (path === '/api/v1/agent-environments/cloud') return Response.json({})
    if (path.endsWith('/machine') && method === 'GET') return Response.json({ state: 'ready' })
    if (path === '/api/v1/conversations/direct-messages') return Response.json({ directMessage: { conversationId: 'conversation' } })
    if (path === '/api/v1/conversations/message') return Response.json({})
    if (path === '/api/v1/conversations/run') return Response.json({ run: { id: 'run', status: reads ? 'completed' : 'running' } })
    if (path === '/api/v1/conversations') {
      reads++
      if (rateLimited && reads === 1) return Response.json({ retryAfterSeconds: 90 }, { status: 429 })
      return Response.json({ messages: [{ id: 'reply', role: 'assistant', authorPrincipalId: 'principal', createdAt: 1, updatedAt: 1, content: 'complete' }] })
    }
    if (method === 'DELETE') return Response.json({})
    throw Error(`Unexpected fixture request ${method} ${path}`)
  })
  const result = await runViaOverlay(['--preview-url', 'http://localhost:3000', '--hard-limit-min', hardLimitMin])
  return { result, calls }
}

test('observation expiry preserves a newly created agent and machine when terminal state is unproven', async t => {
  const { result, calls } = await mockSmoke(t, '0.001', false)
  assert.equal(result, 1)
  assert.equal(calls.filter(call => call.path === '/api/v1/conversations/message').length, 1)
  assert.equal(calls.filter(call => call.method === 'DELETE').length, 0)
})

test('a rate-limited observation resumes the same run after cooldown and cleans up only after completion', async t => {
  const { result, calls } = await mockSmoke(t, '10', true)
  assert.equal(result, 0)
  const reads = calls.filter(call => call.path === '/api/v1/conversations')
  assert.equal(reads.length, 2)
  assert.ok(reads[1]!.at - reads[0]!.at >= 90000)
  assert.equal(calls.filter(call => call.path === '/api/v1/conversations/message').length, 1)
  assert.equal(calls.filter(call => call.path === '/api/v1/agents' && call.method === 'POST').length, 1)
  assert.equal(calls.filter(call => call.method === 'DELETE').length, 2)
})
