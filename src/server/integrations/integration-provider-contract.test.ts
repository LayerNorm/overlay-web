import assert from 'node:assert/strict'
import test from 'node:test'
import type { ToolSet } from 'ai'
import type { AuditService } from '@/server/admin'
import {
  ComposioIntegrationProvider,
  type ComposioSdkFacade,
} from './ComposioIntegrationProvider'
import { DefaultIntegrationPolicyEvaluator } from './DefaultIntegrationPolicyEvaluator'
import { ExecutorIntegrationProvider } from './ExecutorIntegrationProvider'
import { IntegrationService } from './IntegrationService'
import type { IntegrationProvider } from './contracts'

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

async function runProviderContract(args: {
  provider: IntegrationProvider
  expectedProvider: 'composio' | 'executor'
  disconnected: () => boolean
  overlayManagesDisconnect: boolean
}) {
  const health = await args.provider.health()
  assert.equal(health.provider, args.expectedProvider)
  assert.equal(health.status, 'healthy')

  const page = await args.provider.listCatalog({ userId: 'user-1', limit: 20 })
  assert.equal(page.items.length, 1)
  assert.deepEqual(
    Object.keys(page.items[0]!).filter((key) =>
      ['slug', 'providerKey', 'provider', 'name', 'capabilities', 'authenticationState'].includes(key),
    ).sort(),
    ['authenticationState', 'capabilities', 'name', 'provider', 'providerKey', 'slug'],
  )
  assert.equal(page.items[0]!.provider, args.expectedProvider)
  assert.equal(page.items[0]!.providerKey, 'gmail')
  assert.equal(page.items[0]!.isConnected, true)

  const connections = await args.provider.listConnections({ userId: 'user-1' })
  assert.equal(connections.length, 1)
  assert.equal(connections[0]!.providerKey, 'gmail')

  const setup = await args.provider.beginConnection({
    callbackOrigin: 'https://overlay.example.test',
    providerKey: 'gmail',
    userId: 'user-1',
  })
  assert.equal(setup.provider, args.expectedProvider)
  assert.ok(setup.redirectUrl?.startsWith('https://'))

  const tools = await args.provider.createToolSet({ userId: 'user-1' })
  assert.ok(Object.keys(tools).length > 0)

  const policy = new DefaultIntegrationPolicyEvaluator()
  const disconnectDecision = policy.evaluate({
    capabilities: args.provider.capabilities,
    operation: 'disconnect',
  })
  assert.equal(disconnectDecision.allowed, args.overlayManagesDisconnect)
  if (args.overlayManagesDisconnect) {
    await args.provider.disconnect({
      callbackOrigin: 'https://overlay.example.test',
      providerKey: 'gmail',
      userId: 'user-1',
    })
    assert.equal(args.disconnected(), true)
    assert.equal(await args.provider.deleteConnectionsForUser({ userId: 'user-1' }), 1)
  } else {
    assert.equal(args.disconnected(), false)
    assert.equal(await args.provider.deleteConnectionsForUser({ userId: 'user-1' }), 0)
  }
}

test('Composio adapter satisfies the shared integration-provider contract', async () => {
  let disconnected = false
  const sdk: ComposioSdkFacade = {
    authConfigs: {
      list: async () => ({ items: [{ id: 'auth-1' }] }),
      create: async () => ({ id: 'auth-created' }),
    },
    connectedAccounts: {
      link: async () => ({ redirectUrl: 'https://composio.example.test/connect', id: 'link-1' }),
      list: async () => ({ items: [{ id: 'account-1' }] }),
      delete: async () => { disconnected = true },
    },
  }
  const fetcher: typeof fetch = async (input) => {
    const url = String(input)
    if (url.includes('/connected_accounts')) {
      return json({ items: [{ id: 'account-1', status: 'ACTIVE', toolkit: { slug: 'gmail' } }] })
    }
    if (url.endsWith('/toolkits/gmail')) {
      return json({ slug: 'gmail', name: 'Gmail', description: 'Email', logo: null })
    }
    if (url.includes('/toolkits')) {
      return json({ items: [{ slug: 'gmail', name: 'Gmail', description: 'Email' }] })
    }
    return json({}, 404)
  }
  await runProviderContract({
    provider: new ComposioIntegrationProvider({
      fetcher,
      apiKeyResolver: async () => 'test-key',
      sdkFactory: async () => sdk,
      toolSetFactory: async () => ({ COMPOSIO_SEARCH_TOOLS: {} } as unknown as ToolSet),
    }),
    expectedProvider: 'composio',
    disconnected: () => disconnected,
    overlayManagesDisconnect: true,
  })
})

test('Executor adapter satisfies the shared integration-provider contract and executes by exact tool address', async () => {
  let disconnected = false
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input))
    assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer executor-test-key')
    if (url.pathname === '/api/health') return json({ ok: true })
    if (url.pathname === '/api/integrations') {
      return json([{
        slug: 'gmail',
        name: 'Gmail',
        description: 'Email',
        kind: 'openapi',
        canRemove: false,
        canRefresh: true,
        authMethods: [{ id: 'oauth', kind: 'oauth' }],
        displayUrl: 'https://gmail.googleapis.com',
      }])
    }
    if (url.pathname === '/api/integrations/gmail') {
      return json({
        slug: 'gmail', name: 'Gmail', description: 'Email', kind: 'openapi',
        canRemove: false, canRefresh: true, authMethods: [{ id: 'oauth', kind: 'oauth' }],
      })
    }
    if (url.pathname === '/api/connections' && init?.method !== 'DELETE') {
      return json([{
        owner: 'org', name: 'main', integration: 'gmail', address: 'connections.gmail.org.main',
        identityLabel: 'school@example.test', expiresAt: null, lastHealth: { status: 'healthy' },
      }])
    }
    if (url.pathname.startsWith('/api/connections/') && init?.method === 'DELETE') {
      disconnected = true
      return json({ removed: true })
    }
    if (url.pathname === '/api/tools') {
      return json([{
        address: 'gmail.org.main.messages.list', integration: 'gmail', name: 'messages.list',
        description: 'List messages', requiresApproval: false,
      }])
    }
    if (url.pathname === '/api/executions') {
      const body = JSON.parse(String(init?.body)) as { code: string; autoApprove: boolean }
      assert.match(body.code, /gmail\.org\.main\.messages\.list/)
      assert.equal(body.autoApprove, false)
      return json({ status: 'completed', text: 'ok', structured: { messages: [] }, isError: false })
    }
    return json({}, 404)
  }
  const provider = new ExecutorIntegrationProvider({
    apiBaseUrl: 'https://executor.example.test/api',
    webBaseUrl: 'https://executor.example.test',
    apiKey: 'executor-test-key',
    fetcher,
  })
  await runProviderContract({
    provider,
    expectedProvider: 'executor',
    disconnected: () => disconnected,
    overlayManagesDisconnect: false,
  })
  const result = await provider.execute({
    args: { maxResults: 10 },
    toolId: 'gmail.org.main.messages.list',
    userId: 'user-1',
  })
  assert.equal(result.status, 'completed')
  assert.deepEqual(result.output, { messages: [] })
})

test('integration policy reflects provider approval and lifecycle capabilities', () => {
  const policy = new DefaultIntegrationPolicyEvaluator()
  const composio = new ComposioIntegrationProvider()
  const executor = new ExecutorIntegrationProvider({
    apiBaseUrl: 'https://executor.example.test/api',
    webBaseUrl: 'https://executor.example.test',
    apiKey: 'test',
  })
  assert.equal(policy.evaluate({
    capabilities: composio.capabilities,
    operation: 'execute',
    requiresApproval: true,
  }).allowed, false)
  assert.equal(policy.evaluate({
    capabilities: executor.capabilities,
    operation: 'execute',
    requiresApproval: true,
  }).allowed, true)
  assert.equal(policy.evaluate({
    capabilities: executor.capabilities,
    operation: 'disconnect',
  }).allowed, false)
})

test('provider-managed connection deletion is denied and audited', async () => {
  const records: Array<Record<string, unknown>> = []
  const audit = {
    record: async (entry: Record<string, unknown>) => { records.push(entry) },
  } as unknown as AuditService
  const executor = new ExecutorIntegrationProvider({
    apiBaseUrl: 'https://executor.example.test/api',
    webBaseUrl: 'https://executor.example.test',
    apiKey: 'test',
  })
  const service = new IntegrationService(executor, audit)

  await assert.rejects(service.disconnect({
    callbackOrigin: 'https://overlay.example.test',
    providerKey: 'gmail',
    userId: 'user-1',
  }), /does not support disconnect/)
  assert.equal(records.length, 1)
  assert.equal(records[0]?.action, 'integration.connection.delete')
  assert.equal(records[0]?.outcome, 'failure')
  assert.deepEqual(records[0]?.metadata, {
    provider: 'executor',
    denied: true,
    reason: 'Provider does not support disconnect',
  })
})
