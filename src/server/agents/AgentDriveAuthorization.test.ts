import 'server-only'
import assert from 'node:assert/strict'
import test from 'node:test'
import type { AgentBinding, AgentEnvironment, AgentRemoteSession, WorkspaceAccess, WorkspaceAgentDirectoryItem } from '@overlay/workspace-contracts'
import { AgentDriveAuthorization } from './AgentDriveAuthorization'
import { createAgentDriveTokens } from './agent-drive-token'

function fixture() {
  let enabled = true
  let reads = 0
  const now = () => 1000
  const tokens = createAgentDriveTokens({ secret: 'drive-authorization-test-secret-32bytes', now })
  const state: { session: AgentRemoteSession; environment: AgentEnvironment; binding: AgentBinding; agent: WorkspaceAgentDirectoryItem; access: WorkspaceAccess } = {
    session: { id: 'session', workspaceId: 'workspace', environmentId: 'environment', bindingId: 'binding', runId: 'run', status: 'running',
      commandCursor: 0, eventCursor: 0, capabilitySnapshot: { billing: { userId: 'owner', workspaceId: 'workspace', agentId: 'agent', runId: 'run' }, hardExpiresAt: 5000 },
      attemptId: 'attempt', executionGeneration: 1, hardDeadlineAt: 5000, createdAt: 0, updatedAt: 0 },
    environment: { id: 'environment', workspaceId: 'workspace', kind: 'overlay_cloud', name: 'Test', status: 'online', capabilities: {}, createdAt: 0, updatedAt: 0 },
    binding: { id: 'binding', workspaceId: 'workspace', agentId: 'agent', environmentId: 'environment', protocolAdapter: 'acp', adapterConfig: {}, enabled: true, createdAt: 0, updatedAt: 0 },
    agent: { id: 'agent', workspaceId: 'workspace', principalId: 'agent-principal', name: 'Test', instructions: '', harness: 'codex', modelId: 'byo/codex',
      allowedToolIds: [], invocationPolicy: 'mention', visibility: 'creator', createdByPrincipalId: 'owner-principal', teamIds: [], roomCount: 0, createdAt: 0, updatedAt: 0 },
    access: { workspace: { id: 'workspace', kind: 'personal', name: 'Test', slug: 'test', status: 'active', createdAt: 0, updatedAt: 0 },
      principal: { id: 'owner-principal', workspaceId: 'workspace', type: 'human', userId: 'owner', displayName: 'Owner', createdAt: 0, updatedAt: 0 },
      membership: { workspaceId: 'workspace', principalId: 'owner-principal', role: 'member', status: 'active', joinedAt: 0, updatedAt: 0 } },
  }
  const personal = { kind: 'personal' as const, workspaceId: 'workspace', ownerUserId: 'owner' }
  const mint = (scope: Parameters<typeof tokens.mint>[0]['scope'] = personal) => tokens.mint({
    actorUserId: 'owner', agentId: 'agent', environmentId: 'environment', bindingId: 'binding', runId: 'run', sessionId: 'session',
    scope, execution: { attemptId: 'attempt', generation: 1 },
  }, 5000)
  const authorization = new AgentDriveAuthorization({ enabled: () => enabled, verifyToken: tokens.verify, now,
    connected: {
      async getRemoteSessionForRun() { reads++; return state.session },
      async getEnvironment() { return state.environment },
      async listBindings() { return [state.binding] },
    },
    agents: { async get() { return state.agent } },
    workspaces: { async resolveActiveWorkspace() { return state.access } },
  })
  return { state, authorization, mint, disable: () => { enabled = false }, reads: () => reads }
}

test('the drive kill switch and invalid credentials stop before repository reads', async () => {
  const f = fixture()
  await assert.rejects(f.authorization.authorize('not-a-token'), /DRIVE_UNAUTHORIZED/)
  assert.equal(f.reads(), 0)
  f.disable()
  await assert.rejects(f.authorization.authorize(f.mint()), /DRIVE_DISABLED/)
  assert.equal(f.reads(), 0)
})

test('scope is re-derived from persisted visibility and personal ownership on every request', async () => {
  const f = fixture()
  const personal = f.mint()
  assert.equal((await f.authorization.authorize(personal)).claims.scope.kind, 'personal')
  f.state.agent.visibility = 'workspace'
  await assert.rejects(f.authorization.authorize(personal), /DRIVE_RUN_UNAVAILABLE/)
  const shared = f.mint({ kind: 'workspace', workspaceId: 'workspace' })
  assert.equal((await f.authorization.authorize(shared)).claims.scope.kind, 'workspace')
  f.state.agent.visibility = 'creator'
  f.state.agent.createdByPrincipalId = 'someone-else'
  await assert.rejects(f.authorization.authorize(f.mint()), /DRIVE_RUN_UNAVAILABLE/)
})

test('local and VPS drives require persisted opt-in and lose access when it is removed', async () => {
  const f = fixture()
  f.state.environment.kind = 'local'
  const token = f.mint()
  await assert.rejects(f.authorization.authorize(token), /DRIVE_RUN_UNAVAILABLE/)
  f.state.binding.adapterConfig.connectedAgentDrive = true
  await f.authorization.authorize(token)
  f.state.environment.kind = 'vps'
  await f.authorization.authorize(token)
  delete f.state.binding.adapterConfig.connectedAgentDrive
  await assert.rejects(f.authorization.authorize(token), /DRIVE_RUN_UNAVAILABLE/)
})

test('live readback refuses revoked, archived, stale, expired and foreign authority', async () => {
  const changes: Array<(state: ReturnType<typeof fixture>['state']) => void> = [
    state => { state.session.status = 'cancelled' }, state => { state.session.executionGeneration = 2 },
    state => { state.session.id = 'new-attempt' }, state => { state.session.hardDeadlineAt = 3000 },
    state => { state.binding.enabled = false }, state => { state.binding.environmentId = 'another' },
    state => { state.binding.agentId = 'another' }, state => { state.environment.status = 'revoked' },
    state => { state.agent.archivedAt = 1 }, state => { state.access.membership.status = 'suspended' },
    state => { state.access.membership.role = 'guest' }, state => { state.access.principal.userId = 'other' },
    state => { state.session.capabilitySnapshot.billing = { userId: 'another' } },
    state => { state.access.workspace.id = 'another' },
  ]
  for (const change of changes) {
    const f = fixture()
    const token = f.mint()
    await f.authorization.authorize(token)
    change(f.state)
    await assert.rejects(f.authorization.authorize(token), /DRIVE_RUN_UNAVAILABLE/)
    assert.equal(f.reads(), 2)
  }
})
