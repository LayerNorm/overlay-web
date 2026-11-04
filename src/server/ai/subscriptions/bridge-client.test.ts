import assert from 'node:assert/strict'
import test from 'node:test'
import {
  isBridgeCredential,
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

test('non-expiring bridge credentials are accepted only for confirmed providers', () => {
  const credential = {
    backend: 'cliproxyapi',
    version: 1,
    metadata: {},
    expiresAt: null,
    nonExpiring: true,
  }
  assert.equal(isBridgeCredential({ ...credential, providerId: 'meta' }), true)
  assert.equal(isBridgeCredential({ ...credential, providerId: 'devin' }), true)
  assert.equal(isBridgeCredential({ ...credential, providerId: 'kimi' }), false)
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

  await assert.rejects(client.authorize('codex'), /could not complete this request/)
})

test('model discovery preserves optional reasoning capability metadata', async () => {
  const client = new SubscriptionBridgeClient(serviceUrl, secret, async () => Response.json({
    providerId: 'codex',
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
    providerId: 'codex',
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

test('provider-bound model requests preserve the exact provider for all supported IDs', async () => {
  const providers = ['codex', 'claude', 'xai', 'meta', 'kimi', 'kimi-ai', 'devin'] as const
  for (const providerId of providers) {
    let requestedProvider = ''
    const client = new SubscriptionBridgeClient(serviceUrl, secret, async (input, init) => {
      requestedProvider = JSON.parse(String(init?.body)).providerId as string
      assert.equal(new URL(String(input)).pathname, '/internal/v1/models')
      return Response.json({
        providerId,
        source: 'provider_catalog',
        models: [{ id: `${providerId}-model`, name: `${providerId} model` }],
      })
    })
    const result = await client.models({
      backend: 'cliproxyapi',
      version: 1,
      providerId,
      metadata: {},
      expiresAt: Date.now() + 60_000,
    })
    assert.equal(requestedProvider, providerId)
    assert.equal(result.models[0]?.id, `${providerId}-model`)
  }
})

test('bridge rejects a catalog or poll state bound to a different provider', async () => {
  const credential = {
    backend: 'cliproxyapi' as const,
    version: 1 as const,
    providerId: 'claude' as const,
    metadata: {},
    expiresAt: Date.now() + 60_000,
  }
  const catalogClient = new SubscriptionBridgeClient(serviceUrl, secret, async () => Response.json({
    providerId: 'xai',
    source: 'provider_catalog',
    models: [{ id: 'model-a', name: 'Model A' }],
  }))
  await assert.rejects(catalogClient.models(credential), /could not complete this request/)

  const pendingState = {
    backend: 'cliproxyapi' as const,
    version: 1 as const,
    providerId: 'claude' as const,
    metadata: { state: 'opaque' },
    expiresAt: Date.now() + 600_000,
    interval: 5,
  }
  const pollClient = new SubscriptionBridgeClient(serviceUrl, secret, async () => Response.json({
    status: 'pending',
    pendingState: { ...pendingState, providerId: 'devin' },
  }))
  await assert.rejects(pollClient.poll(pendingState), /could not complete this request/)
})

test('poll returns the updated provider-bound interval for durable slowdown handling', async () => {
  const pendingState = {
    backend: 'cliproxyapi' as const,
    version: 1 as const,
    providerId: 'xai' as const,
    metadata: { deviceCode: 'opaque' },
    expiresAt: Date.now() + 600_000,
    interval: 5,
  }
  const client = new SubscriptionBridgeClient(serviceUrl, secret, async () => Response.json({
    status: 'pending',
    pendingState: { ...pendingState, interval: 15 },
  }))
  const result = await client.poll(pendingState)
  assert.equal(result.status, 'pending')
  assert.equal(result.pendingState?.providerId, 'xai')
  assert.equal(result.pendingState?.interval, 15)
})
