import assert from 'node:assert/strict'
import test from 'node:test'
import { subscriptionLogo, subscriptionRequest } from './subscription-connection-client'

test('provider logos reflect providers rather than coding harnesses', () => {
  assert.equal(subscriptionLogo('subscription:codex'), 'openai')
  assert.equal(subscriptionLogo('kimi-ai'), 'moonshotai')
  assert.equal(subscriptionLogo('meta'), 'meta-llama')
})

test('subscription operations use the authenticated BFF, no-store and idempotency', async (t) => {
  const calls: { url: string; init: RequestInit }[] = []
  t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    calls.push({ url, init })
    return Response.json({ data: { status: 'pending' } })
  })
  const data = await subscriptionRequest({ providerId: 'codex' }, { method: 'POST', idempotencyKey: 'test-request' })
  assert.deepEqual(data, { status: 'pending' })
  assert.equal(calls[0].url, '/api/v1/providers/subscriptions')
  assert.equal(calls[0].init.cache, 'no-store')
  assert.equal(calls[0].init.method, 'POST')
  assert.equal(new Headers(calls[0].init.headers).get('Idempotency-Key'), 'test-request')
  assert.deepEqual(JSON.parse(calls[0].init.body as string), { providerId: 'codex' })
})

test('HTTP and BFF errors do not become false connection successes', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({ error: { message: 'Subscription unavailable' } }, { status: 503 }))
  await assert.rejects(subscriptionRequest(), /Subscription unavailable/)
  t.mock.method(globalThis, 'fetch', async () => Response.json({ success: true }))
  await assert.rejects(subscriptionRequest(), /Could not reach subscription connections/)
})
