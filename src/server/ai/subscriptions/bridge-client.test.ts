import assert from 'node:assert/strict'
import test from 'node:test'
import {
  isBridgePendingState,
  SubscriptionBridgeClient,
} from './bridge-client'

const serviceUrl = 'http://subscriptions.internal'
const secret = 'test-service-secret-with-more-than-32-characters'

test('pending-state validation accepts expired well-formed state', () => {
  assert.equal(isBridgePendingState({
    backend: 'cliproxyapi',
    version: 1,
    providerId: 'codex',
    metadata: { deviceAuthId: 'opaque' },
    expiresAt: Date.now() - 1,
    interval: 5,
  }), true)
})

test('authorization rejects expired pending state', async () => {
  const client = new SubscriptionBridgeClient(serviceUrl, secret, async () => Response.json({
    authorization: {
      url: 'https://auth.openai.com/codex/device',
      userCode: 'ABCD-1234',
      expiresAt: Date.now() + 60_000,
      interval: 5,
    },
    pendingState: {
      backend: 'cliproxyapi',
      version: 1,
      providerId: 'codex',
      metadata: { deviceAuthId: 'opaque' },
      expiresAt: Date.now() - 1,
      interval: 5,
    },
  }))

  await assert.rejects(client.authorize(), /could not complete this request/)
})

test('model discovery preserves optional reasoning capability metadata', async () => {
  const client = new SubscriptionBridgeClient(serviceUrl, secret, async () => Response.json({
    source: 'provider_catalog',
    models: [{ id: 'model-a', name: 'Model A', reasoningLevels: ['low', 'high'] }],
  }))
  assert.deepEqual(await client.models({
    backend: 'cliproxyapi',
    version: 1,
    providerId: 'codex',
    metadata: {},
    expiresAt: Date.now() + 60_000,
  }), {
    source: 'provider_catalog',
    models: [{ id: 'model-a', name: 'Model A', reasoningLevels: ['low', 'high'] }],
  })
})

test('oversized bridge responses are cancelled before the body is fully read', async () => {
  let canceled = false
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(2_000_001))
    },
    cancel() {
      canceled = true
    },
  })
  const client = new SubscriptionBridgeClient(
    serviceUrl,
    secret,
    async () => new Response(body),
  )

  await assert.rejects(client.models({
    backend: 'cliproxyapi',
    version: 1,
    providerId: 'codex',
    metadata: {},
    expiresAt: Date.now() + 60_000,
  }), /could not complete this request/)
  assert.equal(canceled, true)
})
