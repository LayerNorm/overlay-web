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
    agentRole: 'workspace_chief',
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
    listBindingsByChannel: async () => (args.binding ? [args.binding] : []),
  } as unknown as SurfaceRepository
  const agents = {
    get: async () => args.agent ?? null,
    list: async () => args.agent ? [args.agent] : [],
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

test('resolveInboundBindings returns the live binding, agent, and creator identity', async () => {
  const service = serviceWith({ connection: connection(), binding: binding(), agent: agent() })
  const [resolved] = await service.resolveInboundBindings({
    platform: 'slack',
    externalTeamId: 'T1',
    channelId: 'C1',
  })
  assert.equal(resolved?.binding.id, 'surface_binding_1')
  assert.equal(resolved?.agent.id, 'agent_1')
  assert.equal(resolved?.creatorUserId, 'user_creator')
  assert.equal(resolved?.creatorPrincipalId, 'principal_creator_1')
})

test('resolveInboundBindings no-ops for missing, degraded, or removed routing', async () => {
  // Unknown team — the install was never completed or belongs elsewhere.
  assert.deepEqual(await serviceWith({ connection: null }).resolveInboundBindings({
    platform: 'slack', externalTeamId: 'T_UNKNOWN', channelId: 'C1',
  }), [])
  // Degraded connection (token revoked) stops routing until repaired.
  assert.deepEqual(await serviceWith({
    connection: connection({ status: 'degraded' }),
    binding: binding(),
    agent: agent(),
  }).resolveInboundBindings({ platform: 'slack', externalTeamId: 'T1', channelId: 'C1' }), [])
  // Removed binding — the channel was disconnected in the editor.
  assert.deepEqual(await serviceWith({
    connection: connection(),
    binding: binding({ status: 'removed' }),
    agent: agent(),
  }).resolveInboundBindings({ platform: 'slack', externalTeamId: 'T1', channelId: 'C1' }), [])
  // Archived agent — the row is gone but the binding remains.
  assert.deepEqual(await serviceWith({
    connection: connection(),
    binding: binding(),
    agent: agent({ archivedAt: Date.now() }),
  }).resolveInboundBindings({ platform: 'slack', externalTeamId: 'T1', channelId: 'C1' }), [])
})

const memberActor = {
  userId: 'user_actor',
  principalId: 'principal_actor',
  workspaceRole: 'member' as const,
}

test('canBindAgent is true for admins on the workspace Chief', async () => {
  const service = serviceWith({ agent: agent() })
  assert.equal(await service.canBindAgent({
    actor: { ...memberActor, workspaceRole: 'admin' }, workspaceId: 'workspace_1', agentId: 'agent_1',
  }), true)
})

test('canBindAgent is false for guests and non-creators of personal agents', async () => {
  const service = serviceWith({ agent: agent() })
  // Guest — can see the agent but cannot bind it.
  assert.equal(await service.canBindAgent({
    actor: { ...memberActor, workspaceRole: 'guest' },
    workspaceId: 'workspace_1', agentId: 'agent_1',
  }), false)
  // Personal agent, actor is not the creator — invisible to them.
  const personal = serviceWith({
    agent: agent({ visibility: 'creator', createdByPrincipalId: 'principal_creator_1' }),
  })
  assert.equal(await personal.canBindAgent({
    actor: memberActor, workspaceId: 'workspace_1', agentId: 'agent_1',
  }), false)
  // Personal ownership does not grant Slack management.
  assert.equal(await personal.canBindAgent({
    actor: { ...memberActor, principalId: 'principal_creator_1' },
    workspaceId: 'workspace_1', agentId: 'agent_1',
  }), false)
  // Missing agent — a miss must not turn into a thrown error for the UI.
  assert.equal(await serviceWith({ agent: null }).canBindAgent({
    actor: memberActor, workspaceId: 'workspace_1', agentId: 'agent_1',
  }), false)
})

test('resolveInboundBindings no-ops when the creator principal has no user', async () => {
  const service = serviceWith({
    connection: connection(),
    binding: binding(),
    agent: agent(),
    principal: { id: 'principal_creator_1' },
  })
  assert.deepEqual(await service.resolveInboundBindings({
    platform: 'slack', externalTeamId: 'T1', channelId: 'C1',
  }), [])
})

function serviceWithConnections(connections: SurfaceConnection[]) {
  const updates: Array<{ id: string; patch: Partial<SurfaceConnection> }> = []
  const repository = {
    findConnectionByTeam: async (_platform: string, teamId: string) =>
      connections.find((row) => row.externalTeamId === teamId) ?? null,
    updateConnection: async (id: string, patch: Partial<SurfaceConnection>) => {
      updates.push({ id, patch })
      const row = connections.find((candidate) => candidate.id === id)
      if (!row) throw new Error('missing connection')
      Object.assign(row, patch)
      return row
    },
    listBindingsByChannel: async () => [],
  } as unknown as SurfaceRepository
  const service = new SurfaceService({
    repository,
    agents: { get: async () => null } as unknown as WorkspaceAgentRepository,
    channelLister: async () => [],
    now: () => 999,
  })
  return { service, updates }
}

test('degradeConnectionByTeam marks the install non-active and stops routing', async () => {
  const rows = [connection()]
  const { service, updates } = serviceWithConnections(rows)
  // tokens_revoked → degraded.
  assert.equal(await service.degradeConnectionByTeam({
    platform: 'slack', teamId: 'T1', status: 'degraded',
  }), true)
  assert.deepEqual(updates, [{ id: 'surface_connection_1', patch: { status: 'degraded', updatedAt: 999 } }])
  assert.equal(rows[0]!.status, 'degraded')
  // The degraded row no longer routes inbound messages.
  assert.deepEqual(await service.resolveInboundBindings({
    platform: 'slack', externalTeamId: 'T1', channelId: 'C1',
  }), [])
  // Idempotent — a retried event does not write again.
  assert.equal(await service.degradeConnectionByTeam({
    platform: 'slack', teamId: 'T1', status: 'degraded',
  }), false)
  assert.equal(updates.length, 1)
})

test('degradeConnectionByTeam records app_uninstalled as uninstalled', async () => {
  const { service, updates } = serviceWithConnections([connection()])
  assert.equal(await service.degradeConnectionByTeam({
    platform: 'slack', teamId: 'T1', status: 'uninstalled',
  }), true)
  assert.equal(updates[0]?.patch.status, 'uninstalled')
})

test('degradeConnectionByTeam falls back to the enterprise id for org installs', async () => {
  // Org-level installs store the enterprise id as externalTeamId.
  const { service, updates } = serviceWithConnections([
    connection({ externalTeamId: 'E1', externalEnterpriseId: 'E1' }),
  ])
  assert.equal(await service.degradeConnectionByTeam({
    platform: 'slack', teamId: 'T_UNKNOWN', enterpriseId: 'E1', status: 'degraded',
  }), true)
  assert.equal(updates.length, 1)
})

test('degradeConnectionByTeam no-ops for unknown teams and missing ids', async () => {
  const { service, updates } = serviceWithConnections([connection()])
  assert.equal(await service.degradeConnectionByTeam({
    platform: 'slack', teamId: 'T_UNKNOWN', status: 'degraded',
  }), false)
  assert.equal(await service.degradeConnectionByTeam({
    platform: 'slack', status: 'degraded',
  }), false)
  assert.equal(updates.length, 0)
})

test('only an admin can bind the server-resolved Chief to an eligible channel', async () => {
  const rows: SurfaceBinding[] = []
  const agents: Record<string, WorkspaceAgentDirectoryItem> = {
    agent_1: agent({ id: 'agent_1', name: 'PR agent' }),
    agent_2: agent({ id: 'agent_2', name: 'Product Agent', agentRole: 'agent' }),
  }
  const repository = {
    getConnection: async () => connection(),
    findConnectionByTeam: async () => connection(),
    listBindingsByChannel: async (_connectionId: string, channelId: string) =>
      rows.filter((row) => row.channelId === channelId),
    createBinding: async (row: SurfaceBinding) => { rows.push(row); return row },
  } as unknown as SurfaceRepository
  let nextId = 0
  const service = new SurfaceService({
    repository,
    agents: {
      get: async ({ agentId }: { agentId: string }) => agents[agentId] ?? null,
      list: async () => Object.values(agents),
    } as unknown as WorkspaceAgentRepository,
    channelLister: async () => [{ id: 'C1', name: 'general', isMember: true }],
    resolvePrincipal: async (principalId) => ({ id: principalId, userId: 'user_creator' }) as never,
    id: () => `id_${++nextId}`,
  })
  const bind = (agentId?: string, channelId = 'C1', actor = { ...memberActor, workspaceRole: 'admin' as const }) => service.createBinding({
    actor,
    workspaceId: 'workspace_1',
    agentId,
    connectionId: 'surface_connection_1',
    channelId,
    channelName: 'general',
  })

  await assert.rejects(service.createBinding({ actor: memberActor, workspaceId: 'workspace_1', connectionId: 'surface_connection_1', channelId: 'C1' }), /admin or owner/)
  await assert.rejects(bind('agent_2'), /Only the workspace Chief/)
  for (const channelId of ['D1', 'G1', 'Cshared']) await assert.rejects(bind(undefined, channelId), /Only public, non-shared/)
  await bind()
  await assert.rejects(bind('agent_1'), /already connected to the agent/)

  const inbound = await service.resolveInboundBindings({ platform: 'slack', externalTeamId: 'T1', channelId: 'C1' })
  assert.deepEqual(inbound.map(({ agent: bound }) => bound.name), ['PR agent'])
  rows.push(binding({ id: 'legacy', agentId: 'agent_2' }))
  assert.equal((await service.resolveInboundBindings({ platform: 'slack', externalTeamId: 'T1', channelId: 'C1' })).length, 1)
})

test('legacy specialist bindings never route and non-admins cannot manage connections or channels', async () => {
  const service = serviceWith({ connection: connection(), binding: binding(), agent: agent({ agentRole: 'agent' }) })
  assert.deepEqual(await service.resolveInboundBindings({ platform: 'slack', externalTeamId: 'T1', channelId: 'C1' }), [])
  for (const workspaceRole of ['member', 'guest'] as const) {
    const actor = { ...memberActor, workspaceRole }
    assert.throws(() => service.requireManager(actor), /admin or owner/)
    await assert.rejects(service.requireBindableAgent({ actor, workspaceId: 'workspace_1', agentId: 'agent_1' }), /admin or owner/)
    await assert.rejects(service.removeBinding({ actor, workspaceId: 'workspace_1', bindingId: 'legacy' }), /admin or owner/)
    await assert.rejects(service.disconnect({ actor, workspaceId: 'workspace_1', connectionId: 'connection' }), /admin or owner/)
    await assert.rejects(service.registerConnection({ actor, workspaceId: 'workspace_1', platform: 'slack', externalTeamId: 'T1', installedByUserId: actor.userId }), /admin or owner/)
    await assert.rejects(service.listChannels({ actor, workspaceId: 'workspace_1', connectionId: 'connection', adapter: {} }), /admin or owner/)
  }
})
