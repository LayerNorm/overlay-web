import assert from 'node:assert/strict'
import test from 'node:test'
import { NextRequest } from 'next/server'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import type {
  ProviderConnectionRepository,
  UpdateProviderConnectionInput,
} from '@/server/ai/provider-connections'
import type { ByokConnectionRow } from '@/shared/ai/gateway/byok-model-conversion'

const originalEnv = {
  nextPhase: process.env.NEXT_PHASE,
  deploymentEnv: process.env.OVERLAY_DEPLOYMENT_ENV,
  internalApiSecret: process.env.INTERNAL_API_SECRET,
  brokerUrl: process.env.OVERLAY_SUBSCRIPTION_BROKER_URL,
  brokerKey: process.env.OVERLAY_SUBSCRIPTION_BROKER_KEY,
  enabledProviders: process.env.OVERLAY_SUBSCRIPTION_ENABLED_PROVIDERS,
}
process.env.NEXT_PHASE = 'phase-production-build'
process.env.OVERLAY_DEPLOYMENT_ENV = 'test'
process.env.INTERNAL_API_SECRET = 'test-internal-secret'
process.env.OVERLAY_SUBSCRIPTION_BROKER_URL = 'https://broker.example.test'
process.env.OVERLAY_SUBSCRIPTION_BROKER_KEY = 'b'.repeat(48)
process.env.OVERLAY_SUBSCRIPTION_ENABLED_PROVIDERS = 'xai'

test.after(() => {
  for (const [key, value] of Object.entries({
    NEXT_PHASE: originalEnv.nextPhase,
    OVERLAY_DEPLOYMENT_ENV: originalEnv.deploymentEnv,
    INTERNAL_API_SECRET: originalEnv.internalApiSecret,
    OVERLAY_SUBSCRIPTION_BROKER_URL: originalEnv.brokerUrl,
    OVERLAY_SUBSCRIPTION_BROKER_KEY: originalEnv.brokerKey,
    OVERLAY_SUBSCRIPTION_ENABLED_PROVIDERS: originalEnv.enabledProviders,
  })) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
})

function apiContext(userId = 'user_1'): AppApiRouteContext {
  return {
    auth: { userId, accessToken: 'access-token', authType: 'session' },
    capabilities: {} as AppApiRouteContext['capabilities'],
    params: Promise.resolve({}),
    parsedQuery: {},
    parsedJson: {},
    parsedFormData: null,
    appDataCapabilities: {} as AppApiRouteContext['appDataCapabilities'],
    requestFingerprint: 'test-request-fingerprint',
    requestIdempotencyKey: 'test-idempotency-key',
    workspace: {} as AppApiRouteContext['workspace'],
  } as AppApiRouteContext
}

function request(path: string, method: string, body?: unknown): NextRequest {
  return new NextRequest(`https://overlay.test${path}`, {
    method,
    ...(body === undefined ? {} : {
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  })
}

function subscriptionRow(overrides: Partial<ByokConnectionRow> = {}): ByokConnectionRow {
  return {
    _id: 'conn-active',
    providerId: 'subscription:xai',
    authKind: 'subscription',
    subscriptionProvider: 'xai',
    endpoint: '',
    displayName: 'Grok Build subscription',
    enabledModelIds: [],
    discoveredModelsJson: JSON.stringify({ data: [{ id: 'model-a', name: 'Model A' }] }),
    discoveredAt: 1,
    status: 'active',
    isDefault: false,
    isDeletable: true,
    ...overrides,
  }
}

async function loadRoutes() {
  const { getOverlayServerContext } = await import('@/server/bootstrap')
  const server = getOverlayServerContext()
  const repository = server.appData.repositories.providerConnections
  const subscriptions = await import('./route')
  const connections = await import('../connections/route')
  return { repository, subscriptions, connections, server }
}

test('subscription start scopes ownership and rejects disabled or banned providers', async (t) => {
  process.env.OVERLAY_SUBSCRIPTION_ENABLED_PROVIDERS = 'xai'
  const { repository, subscriptions } = await loadRoutes()
  const lookups: string[] = []
  t.mock.method(repository, 'get', async (args: Parameters<ProviderConnectionRepository['get']>[0]) => {
    lookups.push(args.userId)
    return null
  })
  t.mock.method(globalThis, 'fetch', async () => {
    throw new Error('broker must not be called')
  })

  const foreign = await subscriptions.POST(request(
    '/api/v1/providers/subscriptions',
    'POST',
    { providerId: 'xai', connectionId: 'foreign-connection' },
  ), apiContext())
  assert.equal(foreign.status, 404)
  assert.deepEqual(lookups, ['user_1'])

  process.env.OVERLAY_SUBSCRIPTION_ENABLED_PROVIDERS = ''
  const disabled = await subscriptions.POST(request(
    '/api/v1/providers/subscriptions',
    'POST',
    { providerId: 'xai' },
  ), apiContext())
  assert.equal(disabled.status, 404)

  const banned = await subscriptions.POST(request(
    '/api/v1/providers/subscriptions',
    'POST',
    { providerId: 'anthropic' },
  ), apiContext())
  assert.equal(banned.status, 400)
})

test('repeated connected polling preserves an explicit empty model selection', async (t) => {
  process.env.OVERLAY_SUBSCRIPTION_ENABLED_PROVIDERS = 'xai'
  const { repository, subscriptions } = await loadRoutes()
  let row = subscriptionRow()
  const updates: Array<Record<string, unknown>> = []
  const brokerRequests: Array<{ path: string; body: Record<string, unknown> }> = []
  t.mock.method(repository, 'get', async ({ connectionId, userId }: { connectionId: string; userId: string }) =>
    connectionId === row._id && userId === 'user_1' ? { ...row, userId } : null)
  t.mock.method(repository, 'update', async (args: UpdateProviderConnectionInput) => {
    updates.push(args)
    row = { ...row, ...args } as ByokConnectionRow
  })
  t.mock.method(globalThis, 'fetch', async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input.toString() : input.url)
    const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
    brokerRequests.push({ path: url.pathname, body })
    return Response.json(url.pathname.endsWith('/poll')
      ? { status: 'connected', models: [{ id: 'model-a', name: 'Model A' }] }
      : { status: 'connected' })
  })

  const response = await subscriptions.PATCH(request(
    '/api/v1/providers/subscriptions',
    'PATCH',
    { connectionId: row._id, action: 'poll' },
  ), apiContext())
  assert.equal(response.status, 200)
  assert.equal((await response.json() as { data: { status: string } }).data.status, 'connected')
  assert.deepEqual(row.enabledModelIds, [])
  assert.deepEqual(updates.at(-1)?.enabledModelIds, [])
  assert.deepEqual(brokerRequests.find((item) => item.path.endsWith('/models'))?.body.enabledModelIds, [])
})

test('subscription metadata cannot forge discovery through generic connection edits', async (t) => {
  process.env.OVERLAY_SUBSCRIPTION_ENABLED_PROVIDERS = 'xai'
  const { repository, connections } = await loadRoutes()
  const row = subscriptionRow()
  t.mock.method(repository, 'get', async () => ({ ...row, userId: 'user_1' }))
  t.mock.method(repository, 'update', async () => {
    throw new Error('metadata must not be updated')
  })

  const response = await connections.PATCH(request(
    '/api/v1/providers/connections',
    'PATCH',
    { connectionId: row._id, discoveredModelsJson: JSON.stringify({ data: [{ id: 'forged' }] }) },
  ), apiContext())
  assert.equal(response.status, 400)
})

test('an unavailable selected subscription model never falls back to the hosted gateway', async (t) => {
  process.env.OVERLAY_SUBSCRIPTION_ENABLED_PROVIDERS = 'xai'
  const { repository, server } = await loadRoutes()
  t.mock.method(repository, 'get', async () => ({
    ...subscriptionRow({ status: 'error' }),
    userId: 'user_1',
  }))
  let hostedCalls = 0
  t.mock.method(server.llmGateway, 'createLanguageModel', async () => {
    hostedCalls += 1
    throw new Error('hosted gateway must not be called')
  })
  const { getLanguageModel } = await import('@/server/ai/model-runtime')

  await assert.rejects(
    getLanguageModel('byok/conn-active/model-a', 'access-token', 'user_1'),
    /Subscription connection is unavailable/,
  )
  assert.equal(hostedCalls, 0)
})

test('failed authorization cleanup and disconnect retain connection metadata', async (t) => {
  process.env.OVERLAY_SUBSCRIPTION_ENABLED_PROVIDERS = 'xai'
  const { repository, subscriptions, connections } = await loadRoutes()
  let row: ByokConnectionRow & { userId: string } =
    { ...subscriptionRow({ _id: 'conn-new', status: 'pending' }), userId: 'user_1' }
  const removed: string[] = []
  t.mock.method(repository, 'count', async () => 0)
  t.mock.method(repository, 'create', async () => {
    return row._id
  })
  t.mock.method(repository, 'get', async ({ connectionId, userId }: { connectionId: string; userId: string }) =>
    connectionId === row._id && userId === row.userId ? { ...row } : null)
  t.mock.method(repository, 'update', async (args: UpdateProviderConnectionInput) => {
    row = { ...row, ...args }
  })
  t.mock.method(repository, 'remove', async ({ connectionId }: Parameters<ProviderConnectionRepository['remove']>[0]) => {
    removed.push(connectionId)
    return row
  })
  t.mock.method(globalThis, 'fetch', async (input: string | URL | Request) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input.toString() : input.url)
    return Response.json({ error: 'broker unavailable' }, { status: url.pathname.endsWith('/start') ? 502 : 503 })
  })

  const start = await subscriptions.POST(request(
    '/api/v1/providers/subscriptions',
    'POST',
    { providerId: 'xai' },
  ), apiContext())
  assert.equal(start.status, 503)
  assert.equal(row.status, 'error')
  assert.match(row.lastError ?? '', /cleanup is pending/)
  assert.deepEqual(removed, [])

  const disconnect = await connections.DELETE(
    new NextRequest(`https://overlay.test/api/v1/providers/connections?connectionId=${row._id}`, { method: 'DELETE' }),
    apiContext(),
  )
  assert.equal(disconnect.status, 500)
  assert.deepEqual(removed, [])
})
