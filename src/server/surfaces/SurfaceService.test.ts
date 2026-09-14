import 'server-only'

import assert from 'node:assert/strict'
import test from 'node:test'

import type {
  SurfaceBinding,
  SurfaceConnection,
  WorkspaceAgentDirectoryItem,
} from '@overlay/workspace-contracts'
import type { WorkspaceAgentRepository } from '@/server/agents/WorkspaceAgentRepository'
import type { SurfaceRepository } from './SurfaceRepository'
import { SurfaceService } from './SurfaceService'

function connection(overrides: Partial<SurfaceConnection> = {}): SurfaceConnection {
  return {
    id: 'surface_connection_1',
    workspaceId: 'workspace_1',
    platform: 'slack',
    externalTeamId: 'T1',
    status: 'active',
    installedByUserId: 'user_1',
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  }
}

function binding(overrides: Partial<SurfaceBinding> = {}): SurfaceBinding {
  return {
    id: 'surface_binding_1',
    connectionId: 'surface_connection_1',
    agentId: 'agent_1',
    channelId: 'C1',
    status: 'active',
    createdByUserId: 'user_1',
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  }
}

function agent(overrides: Partial<WorkspaceAgentDirectoryItem> = {}): WorkspaceAgentDirectoryItem {
  return {
    id: 'agent_1',
    workspaceId: 'workspace_1',
    principalId: 'principal_agent_1',
    name: 'Scout',
    instructions: 'Be helpful.',
    harness: 'overlay',
    modelId: 'openrouter/free',
    allowedToolIds: [],
    invocationPolicy: 'mention',
    visibility: 'workspace',
    createdByPrincipalId: 'principal_creator_1',
    createdAt: 1,
    updatedAt: 1,
    teamIds: [],
    roomCount: 0,
    ...overrides,
  }
}

function serviceWith(args: {
  connection?: SurfaceConnection | null
  binding?: SurfaceBinding | null
  agent?: WorkspaceAgentDirectoryItem | null
  principal?: { id: string; userId?: string } | null
}): SurfaceService {
  const repository = {
    findConnectionByTeam: async () => args.connection ?? null,
    findBindingByChannel: async () => args.binding ?? null,
  } as unknown as SurfaceRepository
  const agents = {
    get: async () => args.agent ?? null,
  } as unknown as WorkspaceAgentRepository
  return new SurfaceService({
    repository,
    agents,
    channelLister: async () => [],
    resolvePrincipal: async (principalId) => (
      args.principal === undefined
        ? { id: principalId, userId: 'user_creator' } as never
        : args.principal as never
    ),
  })
}

test('resolveInboundBinding returns the live binding, agent, and creator identity', async () => {
  const service = serviceWith({ connection: connection(), binding: binding(), agent: agent() })
  const resolved = await service.resolveInboundBinding({
    platform: 'slack',
    externalTeamId: 'T1',
    channelId: 'C1',
  })
  assert.equal(resolved?.binding.id, 'surface_binding_1')
  assert.equal(resolved?.agent.id, 'agent_1')
  assert.equal(resolved?.creatorUserId, 'user_creator')
  assert.equal(resolved?.creatorPrincipalId, 'principal_creator_1')
})

test('resolveInboundBinding no-ops for missing, degraded, or removed routing', async () => {
  // Unknown team — the install was never completed or belongs elsewhere.
  assert.equal(await serviceWith({ connection: null }).resolveInboundBinding({
    platform: 'slack', externalTeamId: 'T_UNKNOWN', channelId: 'C1',
  }), null)
  // Degraded connection (token revoked) stops routing until repaired.
  assert.equal(await serviceWith({
    connection: connection({ status: 'degraded' }),
    binding: binding(),
    agent: agent(),
  }).resolveInboundBinding({ platform: 'slack', externalTeamId: 'T1', channelId: 'C1' }), null)
  // Removed binding — the channel was disconnected in the editor.
  assert.equal(await serviceWith({
    connection: connection(),
    binding: binding({ status: 'removed' }),
    agent: agent(),
  }).resolveInboundBinding({ platform: 'slack', externalTeamId: 'T1', channelId: 'C1' }), null)
  // Archived agent — the row is gone but the binding remains.
  assert.equal(await serviceWith({
    connection: connection(),
    binding: binding(),
    agent: agent({ archivedAt: Date.now() }),
  }).resolveInboundBinding({ platform: 'slack', externalTeamId: 'T1', channelId: 'C1' }), null)
})

test('resolveInboundBinding no-ops when the creator principal has no user', async () => {
  const service = serviceWith({
    connection: connection(),
    binding: binding(),
    agent: agent(),
    principal: { id: 'principal_creator_1' },
  })
  assert.equal(await service.resolveInboundBinding({
    platform: 'slack', externalTeamId: 'T1', channelId: 'C1',
  }), null)
})
