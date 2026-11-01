import assert from 'node:assert/strict'
import test from 'node:test'
import { NextRequest } from 'next/server'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import { ConvexMcpServerRepository } from '@/server/extensions/ConvexMcpServerRepository'
import type { McpServerRecord } from '@/server/extensions/McpServerRepository'

const previousEnv = { phase: process.env.NEXT_PHASE, nodeEnv: process.env.NODE_ENV }
process.env.NEXT_PHASE = 'phase-production-build'
process.env.NODE_ENV = 'development'
test.after(() => {
  if (previousEnv.phase === undefined) delete process.env.NEXT_PHASE
  else process.env.NEXT_PHASE = previousEnv.phase
  if (previousEnv.nodeEnv === undefined) delete process.env.NODE_ENV
  else process.env.NODE_ENV = previousEnv.nodeEnv
})

const context = { auth: { userId: 'user_1' } } as AppApiRouteContext
const saved = {
  _id: 'mcp_1', userId: 'user_1', name: 'OAuth server',
  url: 'https://localhost/mcp', transport: 'streamable-http',
  enabled: true, authType: 'oauth', oauthStatus: 'connected',
  oauthTokens: { accessToken: 'stored-test-token', tokenType: 'Bearer', issuer: 'https://auth.example.test' },
  defaultToolPolicy: 'allow', toolPolicies: {},
} as McpServerRecord

for (const authType of ['oauth', undefined] as const) {
  test(`connection test uses stored OAuth credentials with ${authType ?? 'omitted'} authType`, async (t) => {
    t.mock.method(ConvexMcpServerRepository.prototype, 'get', async (args: { mcpServerId: string; userId: string }) => {
      assert.deepEqual(args, { mcpServerId: saved._id, userId: context.auth.userId })
      return saved
    })
    const catalog = t.mock.method(ConvexMcpServerRepository.prototype, 'updateToolCatalog', async () => {})
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
  })
}

test('connection test rejects inaccessible saved servers before connecting', async (t) => {
  t.mock.method(ConvexMcpServerRepository.prototype, 'get', async () => null)
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js')
  const connect = t.mock.method(Client.prototype, 'connect', async () => {})
  const { POST } = await import('./route')
  const response = await POST(new NextRequest('https://overlay.test/api/v1/mcps/test', {
    method: 'POST', body: JSON.stringify({ mcpServerId: 'inaccessible', url: saved.url, authType: 'oauth' }),
  }), context)
  assert.equal(response.status, 404)
  assert.equal(connect.mock.callCount(), 0)
})
