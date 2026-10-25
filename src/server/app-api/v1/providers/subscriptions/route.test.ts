import assert from 'node:assert/strict'
import test from 'node:test'
import { NextRequest } from 'next/server'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import type { ByokConnectionRow } from '@/shared/ai/gateway/byok-model-conversion'

const originalEnv = {
  nextPhase: process.env.NEXT_PHASE,
  deploymentEnv: process.env.OVERLAY_DEPLOYMENT_ENV,
  internalApiSecret: process.env.INTERNAL_API_SECRET,
}
process.env.NEXT_PHASE = 'phase-production-build'
process.env.OVERLAY_DEPLOYMENT_ENV = 'test'
process.env.INTERNAL_API_SECRET = 'test-internal-secret'

test.after(() => {
  for (const [key, value] of Object.entries({
    NEXT_PHASE: originalEnv.nextPhase,
    OVERLAY_DEPLOYMENT_ENV: originalEnv.deploymentEnv,
    INTERNAL_API_SECRET: originalEnv.internalApiSecret,
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

test('only implemented adapters appear enabled, regardless of the environment allowlist', async (t) => {
  const previous = process.env.OVERLAY_SUBSCRIPTION_ENABLED_PROVIDERS
  process.env.OVERLAY_SUBSCRIPTION_ENABLED_PROVIDERS = 'codex,xai'
  t.after(() => {
    if (previous === undefined) delete process.env.OVERLAY_SUBSCRIPTION_ENABLED_PROVIDERS
    else process.env.OVERLAY_SUBSCRIPTION_ENABLED_PROVIDERS = previous
  })
  const { GET } = await import('./route')
  const response = await GET(request('/api/v1/providers/subscriptions', 'GET'), apiContext())
  const data = (await response.json() as { data: { providers: Array<{ id: string; enabled: boolean }> } }).data
  const providers = data.providers
  assert.equal(providers.find((provider) => provider.id === 'codex')?.enabled, true)
  assert.equal(providers.find((provider) => provider.id === 'xai')?.enabled, false)
})

test('subscription authorization remains owner-scoped and unsupported providers stay disabled', async (t) => {
  const previous = process.env.OVERLAY_SUBSCRIPTION_ENABLED_PROVIDERS
  process.env.OVERLAY_SUBSCRIPTION_ENABLED_PROVIDERS = 'codex'
  t.after(() => {
    if (previous === undefined) delete process.env.OVERLAY_SUBSCRIPTION_ENABLED_PROVIDERS
    else process.env.OVERLAY_SUBSCRIPTION_ENABLED_PROVIDERS = previous
  })
  const { getOverlayServerContext } = await import('@/server/bootstrap')
  const repository = getOverlayServerContext().appData.repositories.providerConnections
  const lookups: string[] = []
  t.mock.method(repository, 'get', async ({ userId }: { userId: string }) => {
    lookups.push(userId)
    return null
  })
  const { POST } = await import('./route')
  const foreign = await POST(request('/api/v1/providers/subscriptions', 'POST', {
    providerId: 'codex',
    connectionId: 'foreign-connection',
  }), apiContext())
  assert.equal(foreign.status, 404)
  assert.deepEqual(lookups, ['user_1'])

  const disabled = await POST(request('/api/v1/providers/subscriptions', 'POST', {
    providerId: 'xai',
  }), apiContext())
  assert.equal(disabled.status, 404)
})

test('generic connection updates cannot forge subscription discovery metadata', async (t) => {
  const { getOverlayServerContext } = await import('@/server/bootstrap')
  const repository = getOverlayServerContext().appData.repositories.providerConnections
  const row: ByokConnectionRow = {
    _id: 'connection-1',
    providerId: 'subscription:codex',
    authKind: 'subscription',
    subscriptionProvider: 'codex',
    endpoint: '',
    displayName: 'ChatGPT subscription',
    enabledModelIds: [],
    discoveredModelsJson: JSON.stringify({ data: [{ id: 'account-model', name: 'Account model' }] }),
    discoveredAt: 1,
    status: 'active',
    isDefault: false,
    isDeletable: true,
  }
  t.mock.method(repository, 'get', async () => ({ ...row, userId: 'user_1' }))
  const { PATCH } = await import('../connections/route')
  const response = await PATCH(request('/api/v1/providers/connections', 'PATCH', {
    connectionId: row._id,
    discoveredModelsJson: JSON.stringify({ data: [{ id: 'forged' }] }),
  }), apiContext())
  assert.equal(response.status, 400)
})
