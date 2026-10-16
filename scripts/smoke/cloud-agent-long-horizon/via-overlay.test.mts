import assert from 'node:assert/strict'
import test from 'node:test'
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
