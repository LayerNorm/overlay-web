import { beforeEach, expect, test, vi } from 'vitest'
import { assertSurfaceAdmissionSource, refreshSurfaceHarnessSource } from './surface-access'
import { surfaceHarnessTurnId, type SurfaceHarnessAuthentication } from './surface-authority'

const mocks = vi.hoisted(() => ({ bindings: vi.fn(), workspace: vi.fn(), conversation: vi.fn(), run: vi.fn() }))
vi.mock('server-only', () => ({}))
vi.mock('@/server/agents/agent-tooling', () => ({
  resolveAgentGrant: ({ allowedToolIds }: { allowedToolIds: string[] }) => ({
    overlayToolIds: allowedToolIds,
    capabilities: new Set(allowedToolIds.includes('integrations') ? ['integrations'] : []),
  }),
}))
vi.mock('@/server/bootstrap', () => ({ getOverlayServerContext: () => ({
  surfaceService: { resolveInboundBindings: mocks.bindings },
  workspaceService: { resolveActiveWorkspace: mocks.workspace },
  appData: { repositories: { conversations: { getConversationById: mocks.conversation, getLatestAgentRun: mocks.run } } },
}) }))

const authentication: SurfaceHarnessAuthentication = {
  type: 'surface', platform: 'slack', bindingId: 'binding', connectionId: 'connection', teamId: 'team',
  channelId: 'channel', threadId: 'thread', messageId: 'message', agentId: 'agent',
  agentPrincipalId: 'agent-principal', creatorPrincipalId: 'principal', originWorkflowRunId: 'workflow',
}
const access = {
  actorUserId: 'user', workspaceId: 'workspace', principalId: 'principal', runId: 'personal:delivery',
  workflowRunId: 'workflow', conversationId: 'conversation', agentRunId: 'delivery', authentication,
}
const context = {
  turnId: surfaceHarnessTurnId(authentication), accountAllowedToolIds: ['read_file', 'write_file'],
  accountAllowedConnectorIds: ['connector'], integrationToolIds: ['connector_tool'],
}
const source = {
  binding: { id: 'binding', connectionId: 'connection', channelId: 'channel', agentId: 'agent', status: 'active' },
  connection: { id: 'connection', workspaceId: 'workspace', status: 'active' },
  agent: { id: 'agent', principalId: 'agent-principal', harness: 'overlay', allowedToolIds: ['read_file'], permissionMode: 'ask' },
  creatorUserId: 'user', creatorPrincipalId: 'principal',
}
const conversation = {
  userId: 'user', workspaceId: 'workspace', conversationType: 'channel', createdByPrincipalId: 'principal',
  externalPlatform: 'slack', externalChannelId: 'channel', externalThreadId: 'thread', surfaceBindingId: 'binding',
}

beforeEach(() => {
  vi.resetAllMocks()
  mocks.bindings.mockResolvedValue([source])
  mocks.workspace.mockResolvedValue({ workspace: { id: 'workspace' }, principal: { id: 'principal' } })
  mocks.conversation.mockResolvedValue(conversation)
  mocks.run.mockResolvedValue({ id: 'delivery', userId: 'user', conversationId: 'conversation',
    turnId: context.turnId, workflowRunId: 'workflow', runner: 'workflow', executionEngine: 'overlay_harness' })
})

test('surface admission checks the canonical inbound identity before conversation writes', async () => {
  const input = { actorUserId: 'user', workspaceId: 'workspace', turnId: context.turnId, surface: authentication }
  expect(await assertSurfaceAdmissionSource(input)).toEqual(source)
  expect(mocks.bindings).toHaveBeenCalledWith({ platform: 'slack', externalTeamId: 'team', channelId: 'channel' })
  await expect(assertSurfaceAdmissionSource({ ...input, turnId: 'other' })).rejects.toThrow('identity')
  await expect(assertSurfaceAdmissionSource({ ...input, actorUserId: 'other' })).rejects.toThrow('authorization')
  expect(mocks.conversation).not.toHaveBeenCalled()
})

test('surface refresh narrows the current grant and rejects revoked bindings after a wait', async () => {
  expect(await refreshSurfaceHarnessSource(access, context, 'workflow')).toMatchObject({
    allowedToolIds: ['read_file'], allowedConnectorIds: [], approvalMode: 'ask', memoryOwnerId: 'agent-memory:agent',
  })
  mocks.bindings.mockResolvedValueOnce([{ ...source, agent: { ...source.agent, allowedToolIds: ['read_file', 'integrations'], permissionMode: 'auto' } }])
  expect(await refreshSurfaceHarnessSource(access, context, 'workflow')).toMatchObject({
    allowedToolIds: ['read_file', 'connector_tool'], allowedConnectorIds: ['connector'], approvalMode: 'auto',
  })
  mocks.bindings.mockResolvedValueOnce([])
  await expect(refreshSurfaceHarnessSource(access, context, 'workflow')).rejects.toThrow('authorization')
})

test('surface refresh does not accept another thread, workflow, or delivery turn', async () => {
  mocks.conversation.mockResolvedValueOnce({ ...conversation, externalThreadId: 'other' })
  await expect(refreshSurfaceHarnessSource(access, context, 'workflow')).rejects.toThrow('conversation ownership')
  await expect(refreshSurfaceHarnessSource(access, context, 'other')).rejects.toThrow('workflow ownership')
  mocks.run.mockResolvedValueOnce({ id: 'delivery', userId: 'user', conversationId: 'conversation',
    turnId: 'other', workflowRunId: 'workflow', runner: 'workflow', executionEngine: 'overlay_harness' })
  await expect(refreshSurfaceHarnessSource(access, context, 'workflow')).rejects.toThrow('delivery ownership')
})

test('descendants preserve the root surface identity rather than replacing it with the child workflow', async () => {
  expect(await refreshSurfaceHarnessSource({ ...access, runId: 'child', workflowRunId: 'child-workflow' }, context, 'workflow'))
    .toMatchObject({ allowedToolIds: ['read_file'] })
})
