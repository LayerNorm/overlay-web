import assert from 'node:assert/strict'
import test from 'node:test'
import { NextRequest } from 'next/server'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import { lazyConvex as convex } from '@/server/database/lazy-convex'
import type { AppDataCapabilities } from '@/server/app-data/capabilities'
import { deriveOverlayCapabilities } from '@overlay/app-core'

const previousEnv = {
  phase: process.env.NEXT_PHASE,
  nodeEnv: process.env.NODE_ENV,
  internalSecret: process.env.INTERNAL_API_SECRET,
  encryptionKey: process.env.MCP_CREDENTIAL_ENCRYPTION_KEY,
}
process.env.NEXT_PHASE = 'phase-production-build'
process.env.NODE_ENV = 'development'
process.env.INTERNAL_API_SECRET = 'test-internal-secret'
process.env.MCP_CREDENTIAL_ENCRYPTION_KEY = 'test-test-test-test-test-test-test-test'
test.after(() => {
  if (previousEnv.phase === undefined) delete process.env.NEXT_PHASE
  else process.env.NEXT_PHASE = previousEnv.phase
  if (previousEnv.nodeEnv === undefined) delete process.env.NODE_ENV
  else process.env.NODE_ENV = previousEnv.nodeEnv
  if (previousEnv.internalSecret === undefined) delete process.env.INTERNAL_API_SECRET
  else process.env.INTERNAL_API_SECRET = previousEnv.internalSecret
  if (previousEnv.encryptionKey === undefined) delete process.env.MCP_CREDENTIAL_ENCRYPTION_KEY
  else process.env.MCP_CREDENTIAL_ENCRYPTION_KEY = previousEnv.encryptionKey
})

const capabilities = { provider: 'convex' } as unknown as AppDataCapabilities

function routeContext(parsedJson: Record<string, unknown>): AppApiRouteContext {
  return {
    auth: { userId: 'user_1', accessToken: 'token', authType: 'session' },
    capabilities: deriveOverlayCapabilities(),
    params: Promise.resolve({}),
    parsedFormData: null,
    parsedJson,
    parsedQuery: {},
    appDataCapabilities: capabilities,
    requestFingerprint: 'fp',
    requestIdempotencyKey: 'key',
    workspace: {
      workspace: { id: 'ws_1', kind: 'organization', name: 'Team', slug: 'team', status: 'active', createdAt: 0, updatedAt: 0 },
      principal: { id: 'principal_1', workspaceId: 'ws_1', type: 'human', displayName: 'Test', createdAt: 0, updatedAt: 0 },
      membership: { membershipId: 'm1', workspaceId: 'ws_1', principalId: 'principal_1', role: 'member', status: 'active', joinedAt: 0, updatedAt: 0 },
    },
  }
}

function request(method: 'POST' | 'PATCH') {
  return new NextRequest('https://overlay.test/api/v1/mcps', { method })
}

for (const authType of ['oauth', 'bearer', 'header', 'none'] as const) {
  test(`MCP create and update preserve ${authType} authentication`, async (t) => {
    const calls: Array<{ path: string; args: Record<string, unknown> }> = []
    const run = async (path: string, args: Record<string, unknown>) => {
      calls.push({ path, args })
      if (path === 'integrations/mcpServers:get') return { _id: 'mcp_1', userId: 'user_1', authType: 'none' }
      return path.endsWith(':create') ? 'mcp_1' : undefined
    }
    t.mock.method(convex, 'query', run)
    t.mock.method(convex, 'mutation', run)

    const route = await import('./route')
    const createBody = { name: 'Server', transport: 'streamable-http', url: 'https://localhost/mcp', authType, enabled: false }
    const created = await route.POST(request('POST'), routeContext(createBody))
    assert.equal(created.status, 200)
    assert.equal(calls.find((call) => call.path.endsWith(':create'))?.args.authType, authType)

    const updateBody = { mcpServerId: 'mcp_1', authType, enabled: false }
    const updated = await route.PATCH(request('PATCH'), routeContext(updateBody))
    assert.equal(updated.status, 200)
    assert.equal(calls.find((call) => call.path.endsWith(':update'))?.args.authType, authType)
  })
}

test('MCP endpoint changes forward the revision and clear stored OAuth state', async (t) => {
  const calls: Array<{ path: string; args: Record<string, unknown> }> = []
  t.mock.method(convex, 'query', async (path: string, args: Record<string, unknown>) => {
    calls.push({ path, args })
    return {
      _id: 'mcp_1',
      userId: 'user_1',
      workspaceId: 'ws_1',
      name: 'Server',
      url: 'https://localhost/old',
      transport: 'streamable-http',
      enabled: true,
      authType: 'oauth',
      oauthStatus: 'connected',
      updatedAt: 17,
    }
  })
  t.mock.method(convex, 'mutation', async (path: string, args: Record<string, unknown>) => {
    calls.push({ path, args })
    return undefined
  })
  const route = await import('./route')
  const response = await route.PATCH(request('PATCH'), routeContext({
    mcpServerId: 'mcp_1',
    expectedUpdatedAt: 17,
    url: 'https://localhost/new',
    enabled: false,
  }))
  assert.equal(response.status, 200)
  const get = calls.find((call) => call.path === 'integrations/mcpServers:get')
  const update = calls.find((call) => call.path === 'integrations/mcpServers:update')
  assert.equal(get?.args.workspaceId, 'ws_1')
  assert.equal(update?.args.expectedUpdatedAt, 17)
  assert.equal(update?.args.clearOAuthState, true)
  assert.equal(update?.args.clearAuthConfig, true)
  assert.equal(update?.args.authConfig, undefined)
  assert.equal(update?.args.encryptedAuthConfig, undefined)
})

test('MCP update maps a stale server revision to a safe reopen response', async (t) => {
  t.mock.method(convex, 'query', async () => ({
    _id: 'mcp_1',
    userId: 'user_1',
    workspaceId: 'ws_1',
    name: 'Server',
    url: 'https://localhost/mcp',
    transport: 'streamable-http',
    enabled: true,
    authType: 'none',
    updatedAt: 18,
  }))
  t.mock.method(convex, 'mutation', async () => {
    throw new Error('MCP_REVISION_CONFLICT')
  })
  const route = await import('./route')
  const response = await route.PATCH(request('PATCH'), routeContext({
    mcpServerId: 'mcp_1',
    expectedUpdatedAt: 17,
    name: 'Stale name',
    enabled: false,
  }))
  assert.equal(response.status, 409)
  assert.deepEqual(await response.json(), {
    error: 'This MCP server changed while you were editing. Reopen it to review the latest settings.',
  })
})
