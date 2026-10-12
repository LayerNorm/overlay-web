import assert from 'node:assert/strict'
import test from 'node:test'
import { NextRequest } from 'next/server'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import type { AuthorizationService } from '@/server/authorization'
import type { IntegrationService } from '@/server/integrations'
import type { WorkspaceConnectorRepository } from '@/server/integrations/WorkspaceConnectorRepository'
import { workspaceConnectorEntityId } from '@/shared/integrations/workspace-connector-entity'
import { GET, POST } from './route'

const context = {
  auth: {
    authType: 'session',
    userId: 'user_1',
  },
  workspace: {
    workspace: { id: 'workspace_1', kind: 'team' },
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

// Both connectors are mapped to the active workspace, so only the catalog
// policy decides what the route exposes.
function workspaceConnectors(): WorkspaceConnectorRepository {
  const mapping = (providerKey: string) => ({
    connectedAccountId: `account_${providerKey}`,
    providerKey,
    userId: 'user_1',
    workspaceId: 'workspace_1',
  })
  return {
    insert: async () => undefined,
    listByUser: async () => [mapping('gmail'), mapping('slack')],
    listByWorkspace: async () => [mapping('gmail'), mapping('slack')],
    remove: async () => undefined,
  } as unknown as WorkspaceConnectorRepository
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
          { id: 'account_gmail', providerKey: 'gmail' },
          { id: 'account_slack', providerKey: 'slack' },
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
    workspaceConnectors: workspaceConnectors(),
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
    workspaceConnectors: workspaceConnectors(),
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

type Calls = { connect: Array<Record<string, unknown>>; disconnect: Array<Record<string, unknown>>; connectedFor: string[]; inserted: Array<Record<string, unknown>>; removedWorkspace: string[] }

function workspaceFixture(options: { role?: 'owner' | 'admin' | 'member'; editors?: 'members' | 'admins'; existingBy?: string } = {}) {
  const calls: Calls = { connect: [], disconnect: [], connectedFor: [], inserted: [], removedWorkspace: [] }
  const service = {
    capabilities: {},
    id: 'composio',
    connect: async (args: Record<string, unknown>) => { calls.connect.push(args); return { status: 'initiated', connectionId: 'conn_1' } },
    disconnect: async (args: Record<string, unknown>) => { calls.disconnect.push(args) },
    listCatalog: async () => ({ hasMore: false, items: [integration('gmail', 'Gmail')], nextCursor: null }),
    listConnected: async (args: { userId: string }) => {
      calls.connectedFor.push(args.userId)
      return { connections: [{ id: 'ws_account', providerKey: 'gmail' }], items: [integration('gmail', 'Gmail')] }
    },
  } as unknown as IntegrationService
  const repository = {
    insert: async (args: Record<string, unknown>) => { calls.inserted.push(args) },
    listByUser: async () => [],
    listByWorkspace: async () => [],
    listScopedByWorkspace: async () => options.existingBy
      ? [{ providerKey: 'gmail', userId: options.existingBy, workspaceId: 'workspace_1' }]
      : [],
    remove: async () => undefined,
    removeWorkspaceConnector: async ({ userId }: { userId: string }) => {
      calls.removedWorkspace.push(userId)
      return options.role === 'member' && options.existingBy !== userId
        ? { ok: false as const, reason: 'forbidden' as const }
        : { ok: true as const, creatorUserId: 'someone' }
    },
  } as unknown as WorkspaceConnectorRepository
  const ctx = {
    ...context,
    workspace: { workspace: { id: 'workspace_1', kind: 'organization' }, membership: { role: options.role ?? 'member' } },
  } as unknown as AppApiRouteContext
  return {
    calls,
    ctx,
    dependencies: {
      authorization: authorization(['gmail']),
      service,
      workspaceConnectors: repository,
      getSharingPolicy: async () => ({ workspaceExtensionsEditors: options.editors ?? 'members' }),
    },
  }
}

test('the Workspace view lists the workspace\'s own accounts and who may disconnect them', async () => {
  const { calls, ctx, dependencies } = workspaceFixture({ role: 'member', existingBy: 'user_1' })
  const response = await GET(new NextRequest('https://overlay.test/api/v1/integrations?view=workspace'), ctx, dependencies)
  const body = await response.json() as { connected: string[]; workspaceConnectors: Array<{ providerKey: string; canDisconnect: boolean }> }
  assert.deepEqual(calls.connectedFor, [workspaceConnectorEntityId('workspace_1')])
  assert.deepEqual(body.connected, ['gmail'])
  assert.deepEqual(body.workspaceConnectors, [{ providerKey: 'gmail', connectedBy: 'user_1', canDisconnect: true }])
  // A member who did not connect it cannot disconnect it; an admin can.
  const other = workspaceFixture({ role: 'member', existingBy: 'user_2' })
  const asMember = await (await GET(new NextRequest('https://overlay.test/api/v1/integrations?view=workspace'), other.ctx, other.dependencies)).json() as { workspaceConnectors: Array<{ canDisconnect: boolean }> }
  assert.equal(asMember.workspaceConnectors[0]!.canDisconnect, false)
  const admin = workspaceFixture({ role: 'admin', existingBy: 'user_2' })
  const asAdmin = await (await GET(new NextRequest('https://overlay.test/api/v1/integrations?view=workspace'), admin.ctx, admin.dependencies)).json() as { workspaceConnectors: Array<{ canDisconnect: boolean }> }
  assert.equal(asAdmin.workspaceConnectors[0]!.canDisconnect, true)
})

test('connecting for the workspace links an account held by the workspace, recorded as the person', async () => {
  const { calls, ctx, dependencies } = workspaceFixture()
  const response = await POST(jsonRequest({ providerKey: 'gmail', scope: 'workspace' }), ctx, dependencies)
  assert.equal(response.status, 200)
  assert.equal(calls.connect[0]!.userId, workspaceConnectorEntityId('workspace_1'))
  assert.equal(calls.connect[0]!.actorUserId, 'user_1')
  assert.deepEqual(calls.inserted[0], { workspaceId: 'workspace_1', userId: 'user_1', providerKey: 'gmail', connectedAccountId: 'conn_1', scope: 'workspace' })
  // Without `scope` it stays the person's own account.
  const personal = workspaceFixture()
  await POST(jsonRequest({ providerKey: 'gmail' }), personal.ctx, personal.dependencies)
  assert.equal(personal.calls.connect[0]!.userId, 'user_1')
  assert.equal('scope' in personal.calls.inserted[0]!, false)
})

test('the workspace\'s accounts follow the admin setting and are one per connector', async () => {
  const restricted = workspaceFixture({ role: 'member', editors: 'admins' })
  const denied = await POST(jsonRequest({ providerKey: 'gmail', scope: 'workspace' }), restricted.ctx, restricted.dependencies)
  assert.equal(denied.status, 403)
  assert.equal(restricted.calls.connect.length, 0)
  const admin = workspaceFixture({ role: 'admin', editors: 'admins' })
  assert.equal((await POST(jsonRequest({ providerKey: 'gmail', scope: 'workspace' }), admin.ctx, admin.dependencies)).status, 200)
  const taken = workspaceFixture({ existingBy: 'user_2' })
  const conflict = await POST(jsonRequest({ providerKey: 'gmail', scope: 'workspace' }), taken.ctx, taken.dependencies)
  assert.equal(conflict.status, 409)
  assert.equal(taken.calls.connect.length, 0)
})

test('disconnecting a workspace account checks who may first, then removes it at the provider', async () => {
  const allowed = workspaceFixture({ role: 'admin' })
  const ok = await POST(jsonRequest({ action: 'disconnect', providerKey: 'gmail', scope: 'workspace' }), allowed.ctx, allowed.dependencies)
  assert.equal(ok.status, 200)
  assert.equal(allowed.calls.disconnect[0]!.userId, workspaceConnectorEntityId('workspace_1'))
  const blocked = workspaceFixture({ role: 'member', existingBy: 'user_2' })
  const forbidden = await POST(jsonRequest({ action: 'disconnect', providerKey: 'gmail', scope: 'workspace' }), blocked.ctx, blocked.dependencies)
  assert.equal(forbidden.status, 403)
  assert.equal(blocked.calls.disconnect.length, 0)
})
