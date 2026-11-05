import assert from 'node:assert/strict'
import test from 'node:test'
import { NextRequest } from 'next/server'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import { lazyConvex as convex } from '@/server/database/lazy-convex'
import { ConvexMcpServerRepository } from '@/server/extensions/ConvexMcpServerRepository'
import type { McpServerRecord } from '@/server/extensions/McpServerRepository'

const previousEnv = {
  phase: process.env.NEXT_PHASE,
  nodeEnv: process.env.NODE_ENV,
  internalSecret: process.env.INTERNAL_API_SECRET,
}
process.env.NEXT_PHASE = 'phase-production-build'
process.env.NODE_ENV = 'development'
process.env.INTERNAL_API_SECRET = 'test-internal-secret'
test.after(() => {
  if (previousEnv.phase === undefined) delete process.env.NEXT_PHASE
  else process.env.NEXT_PHASE = previousEnv.phase
  if (previousEnv.nodeEnv === undefined) delete process.env.NODE_ENV
  else process.env.NODE_ENV = previousEnv.nodeEnv
  if (previousEnv.internalSecret === undefined) delete process.env.INTERNAL_API_SECRET
  else process.env.INTERNAL_API_SECRET = previousEnv.internalSecret
})

const context = {
  auth: { userId: 'user_1' },
  workspace: { workspace: { id: 'workspace_1' } },
} as AppApiRouteContext
const saved = {
  _id: 'mcp_1', userId: 'user_1', workspaceId: 'workspace_1', name: 'OAuth server',
  url: 'https://localhost/mcp', transport: 'streamable-http',
  enabled: true, authType: 'oauth', oauthStatus: 'connected',
  oauthTokens: { accessToken: 'stored-test-token', tokenType: 'Bearer', issuer: 'https://auth.example.test' },
  defaultToolPolicy: 'allow', toolPolicies: {},
} as McpServerRecord

for (const authType of ['oauth', undefined] as const) {
  test(`connection test uses stored OAuth credentials with ${authType ?? 'omitted'} authType`, async (t) => {
    t.mock.method(ConvexMcpServerRepository.prototype, 'get', async (args: { mcpServerId: string; userId: string }) => {
      assert.deepEqual(args, { mcpServerId: saved._id, userId: context.auth.userId, workspaceId: 'workspace_1' })
      return saved
    })
    const catalog = t.mock.method(ConvexMcpServerRepository.prototype, 'updateToolCatalog', async () => {})
    const commandCalls: Array<{ path: string; args: Record<string, unknown> }> = []
    t.mock.method(convex, 'mutation', async (path: string, args: Record<string, unknown>) => {
      commandCalls.push({ path, args })
      return path.endsWith(':begin') ? args.commandId : null
    })
    const { Client } = await import('@modelcontextprotocol/sdk/client/index.js')
    const connect = t.mock.method(Client.prototype, 'connect', async (transport: unknown) => {
      const provider = (transport as { _authProvider?: { tokens: () => { access_token: string } | undefined } })._authProvider
      assert.ok(provider, 'connection test must create the OAuth transport provider')
      assert.equal(provider.tokens()?.access_token, saved.oauthTokens?.accessToken)
    })
    t.mock.method(Client.prototype, 'listTools', async () => ({ tools: [{ name: 'list_workspaces', inputSchema: { type: 'object' } }] }))
    t.mock.method(Client.prototype, 'close', async () => {})
    const { POST } = await import('./route')
    const response = await POST(new NextRequest('https://overlay.test/api/v1/mcps/test', {
      method: 'POST',
      body: JSON.stringify({
        mcpServerId: saved._id, url: saved.url, authType,
        oauthTokens: { accessToken: 'client-supplied-token-must-be-ignored' },
      }),
    }), context)
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), { ok: true, toolCount: 1 })
    assert.equal(connect.mock.callCount(), 1)
    assert.equal(catalog.mock.callCount(), 1)
    assert.equal(commandCalls.find((call) => call.path.endsWith(':begin'))?.args.workspaceId, 'workspace_1')
    assert.equal(commandCalls.find((call) => call.path.endsWith(':finish'))?.args.status, 'succeeded')
  })
}

test('connection test rejects inaccessible saved servers before connecting', async (t) => {
  t.mock.method(ConvexMcpServerRepository.prototype, 'get', async (args: { workspaceId?: string }) => {
    assert.equal(args.workspaceId, 'workspace_1')
    return null
  })
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js')
  const connect = t.mock.method(Client.prototype, 'connect', async () => {})
  const { POST } = await import('./route')
  const response = await POST(new NextRequest('https://overlay.test/api/v1/mcps/test', {
    method: 'POST', body: JSON.stringify({ mcpServerId: 'inaccessible', url: saved.url, authType: 'oauth' }),
  }), context)
  assert.equal(response.status, 404)
  assert.equal(connect.mock.callCount(), 0)
})

test('a changed OAuth endpoint never receives the stored token', async (t) => {
  t.mock.method(ConvexMcpServerRepository.prototype, 'get', async () => saved)
  t.mock.method(ConvexMcpServerRepository.prototype, 'updateToolCatalog', async () => {})
  t.mock.method(convex, 'mutation', async (path: string, args: Record<string, unknown>) =>
    path.endsWith(':begin') ? args.commandId : null)
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js')
  const connect = t.mock.method(Client.prototype, 'connect', async (transport: unknown) => {
    const provider = (transport as { _authProvider?: { tokens: () => { access_token: string } | undefined } })._authProvider
    assert.ok(provider, 'OAuth config should retain an auth provider')
    assert.equal(provider.tokens()?.access_token, undefined)
  })
  t.mock.method(Client.prototype, 'listTools', async () => ({ tools: [] }))
  t.mock.method(Client.prototype, 'close', async () => {})
  const { POST } = await import('./route')
  const response = await POST(new NextRequest('https://overlay.test/api/v1/mcps/test', {
    method: 'POST',
    body: JSON.stringify({
      mcpServerId: saved._id,
      url: 'https://localhost/changed-endpoint',
      authType: 'oauth',
    }),
  }), context)
  assert.equal(response.status, 200)
  assert.equal(connect.mock.callCount(), 1)
})

test('a changed transport never receives the stored OAuth token', async (t) => {
  t.mock.method(ConvexMcpServerRepository.prototype, 'get', async () => saved)
  t.mock.method(ConvexMcpServerRepository.prototype, 'updateToolCatalog', async () => {})
  t.mock.method(convex, 'mutation', async (path: string, args: Record<string, unknown>) =>
    path.endsWith(':begin') ? args.commandId : null)
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js')
  const connect = t.mock.method(Client.prototype, 'connect', async (transport: unknown) => {
    const provider = (transport as { _authProvider?: { tokens: () => { access_token: string } | undefined } })._authProvider
    assert.ok(provider, 'OAuth config should retain an auth provider')
    assert.equal(provider.tokens()?.access_token, undefined)
  })
  t.mock.method(Client.prototype, 'listTools', async () => ({ tools: [] }))
  t.mock.method(Client.prototype, 'close', async () => {})
  const { POST } = await import('./route')
  const response = await POST(new NextRequest('https://overlay.test/api/v1/mcps/test', {
    method: 'POST',
    body: JSON.stringify({
      mcpServerId: saved._id,
      url: saved.url,
      transport: 'sse',
      authType: 'oauth',
    }),
  }), context)
  assert.equal(response.status, 200)
  assert.equal(connect.mock.callCount(), 1)
})

test('a changed bearer endpoint never receives the stored credential', async (t) => {
  const savedBearer = {
    ...saved,
    authType: 'bearer' as const,
    authConfig: { bearerToken: 'stored-bearer-secret' },
    oauthClient: undefined,
    oauthTokens: undefined,
    oauthStatus: undefined,
  } as McpServerRecord
  t.mock.method(ConvexMcpServerRepository.prototype, 'get', async () => savedBearer)
  t.mock.method(ConvexMcpServerRepository.prototype, 'updateToolCatalog', async () => {})
  t.mock.method(convex, 'mutation', async (path: string, args: Record<string, unknown>) =>
    path.endsWith(':begin') ? args.commandId : null)
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js')
  const connect = t.mock.method(Client.prototype, 'connect', async (transport: unknown) => {
    const requestInit = (transport as { _requestInit?: RequestInit })._requestInit
    assert.equal(new Headers(requestInit?.headers).get('Authorization'), null)
  })
  t.mock.method(Client.prototype, 'listTools', async () => ({ tools: [] }))
  t.mock.method(Client.prototype, 'close', async () => {})
  const { POST } = await import('./route')
  const response = await POST(new NextRequest('https://overlay.test/api/v1/mcps/test', {
    method: 'POST',
    body: JSON.stringify({
      mcpServerId: saved._id,
      url: 'https://localhost/changed-endpoint',
      authType: 'bearer',
    }),
  }), context)
  assert.equal(response.status, 200)
  assert.equal(connect.mock.callCount(), 1)
})

test('external test failures finish as failed and expose only a generic error', async (t) => {
  t.mock.method(ConvexMcpServerRepository.prototype, 'get', async () => saved)
  const catalog = t.mock.method(ConvexMcpServerRepository.prototype, 'updateToolCatalog', async () => {})
  const commandCalls: Array<{ path: string; args: Record<string, unknown> }> = []
  t.mock.method(convex, 'mutation', async (path: string, args: Record<string, unknown>) => {
    commandCalls.push({ path, args })
    return path.endsWith(':begin') ? args.commandId : null
  })
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js')
  t.mock.method(Client.prototype, 'connect', async () => {
    throw new Error('provider leaked token=raw-secret')
  })
  const { POST } = await import('./route')
  const response = await POST(new NextRequest('https://overlay.test/api/v1/mcps/test', {
    method: 'POST',
    body: JSON.stringify({ mcpServerId: saved._id, url: saved.url, useStoredConfig: true }),
  }), context)
  assert.equal(response.status, 502)
  const payload = await response.json()
  assert.deepEqual(payload, { ok: false, error: 'Could not connect to this MCP server.' })
  assert.equal(JSON.stringify(payload).includes('raw-secret'), false)
  assert.equal(commandCalls.find((call) => call.path.endsWith(':finish'))?.args.status, 'failed')
  assert.equal(catalog.mock.callCount(), 1)
})
