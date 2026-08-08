import assert from 'node:assert/strict'
import test from 'node:test'
import { NextRequest } from 'next/server'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import type { AuthorizationService } from '@/server/authorization'
import type { IntegrationService } from '@/server/integrations'
import { GET, POST } from './route'

const context = {
  auth: {
    authType: 'session',
    userId: 'user_1',
  },
  authorization: {
    evaluation: {
      mode: 'enforce',
      subject: {
        capabilities: ['integrations.use'],
        groupIds: [],
        isDeploymentOwner: false,
        roleIds: [],
        userId: 'user_1',
      },
    },
  },
} as unknown as AppApiRouteContext

function authorization(allowedIds: readonly string[]): AuthorizationService {
  return {
    checkResolvedCatalogResourceAccess: async ({ resourceId }: { resourceId: string }) => ({
      allowed: allowedIds.includes(resourceId),
      capability: 'integrations.use',
      reason: allowedIds.includes(resourceId)
        ? 'resource_access_granted'
        : 'resource_access_missing',
    }),
    filterCatalogResourceIds: async ({ resourceIds }: { resourceIds: readonly string[] }) => (
      resourceIds.filter((id) => allowedIds.includes(id))
    ),
  } as unknown as AuthorizationService
}

function integrations() {
  const connected: string[] = []
  return {
    connected,
    service: {
      capabilities: {},
      connect: async ({ providerKey }: { providerKey: string }) => {
        connected.push(providerKey)
        return { status: 'ready' }
      },
      disconnect: async () => undefined,
      id: 'composio',
      listCatalog: async () => ({
        hasMore: false,
        items: [
          integration('gmail', 'Gmail'),
          integration('slack', 'Slack'),
        ],
        nextCursor: null,
      }),
      listConnected: async () => ({
        connections: [
          { providerKey: 'gmail' },
          { providerKey: 'slack' },
        ],
        items: [
          integration('gmail', 'Gmail'),
          integration('slack', 'Slack'),
        ],
      }),
    } as unknown as IntegrationService,
  }
}

test('integration catalog and connected state omit connectors withheld by policy', async () => {
  const fixture = integrations()
  const dependencies = {
    authorization: authorization(['gmail']),
    service: fixture.service,
  }

  const searchResponse = await GET(
    new NextRequest('https://overlay.test/api/v1/integrations?action=search'),
    context,
    dependencies,
  )
  const search = await searchResponse.json() as {
    items: Array<{ providerKey: string }>
  }
  assert.deepEqual(search.items.map(({ providerKey }) => providerKey), ['gmail'])

  const connectedResponse = await GET(
    new NextRequest('https://overlay.test/api/v1/integrations'),
    context,
    dependencies,
  )
  const connected = await connectedResponse.json() as {
    connected: string[]
    items: Array<{ providerKey: string }>
  }
  assert.deepEqual(connected.connected, ['gmail'])
  assert.deepEqual(connected.items.map(({ providerKey }) => providerKey), ['gmail'])
})

test('connector policy rejects direct connection attempts server-side', async () => {
  const fixture = integrations()
  const dependencies = {
    authorization: authorization(['gmail']),
    service: fixture.service,
  }
  const denied = await POST(
    jsonRequest({ providerKey: 'slack' }),
    context,
    dependencies,
  )
  assert.equal(denied.status, 403)
  assert.deepEqual(fixture.connected, [])

  const allowed = await POST(
    jsonRequest({ providerKey: 'gmail' }),
    context,
    dependencies,
  )
  assert.equal(allowed.status, 200)
  assert.deepEqual(fixture.connected, ['gmail'])
})

test('catalog configuration failures return actionable, sanitized errors', async () => {
  const fixture = integrations()
  fixture.service.listCatalog = async () => {
    throw new Error('Composio rejected the configured API key (HTTP 401). Rotate COMPOSIO_API_KEY and retry.')
  }

  const response = await GET(
    new NextRequest('https://overlay.test/api/v1/integrations?action=search'),
    context,
    { service: fixture.service },
  )

  assert.equal(response.status, 502)
  assert.deepEqual(await response.json(), {
    connected: [],
    items: [],
    error: 'Composio rejected the configured API key (HTTP 401). Rotate COMPOSIO_API_KEY and retry.',
  })
})

function integration(providerKey: string, name: string) {
  return {
    authenticationState: 'not_connected' as const,
    capabilities: [],
    description: `${name} connector`,
    id: providerKey,
    name,
    provider: 'composio' as const,
    providerKey,
    slug: providerKey,
  }
}

function jsonRequest(body: unknown): NextRequest {
  return new NextRequest('https://overlay.test/api/v1/integrations', {
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
    method: 'POST',
  })
}
