import { beforeEach, expect, test, vi } from 'vitest'
import { createHarnessSnapshot } from '@overlay/agent-runtime/harness-state'
import { refreshNativeHarnessAccess, type NativeHarnessAccess, type NativeHarnessContext } from './native-access'

const mocks = vi.hoisted(() => ({
  state: vi.fn(), room: vi.fn(), workspace: vi.fn(), run: vi.fn(), gate: vi.fn(), subject: vi.fn(),
  capability: vi.fn(), catalog: vi.fn(), models: vi.fn(), byok: vi.fn(),
}))
vi.mock('server-only', () => ({}))
vi.mock('./ConvexHarnessRepository', () => ({ ConvexHarnessRepository: class { get = mocks.state } }))
vi.mock('@/server/agents/workspace-agent-invocation', () => ({
  loadRoomTurnContext: mocks.room, agentModelAttempts: (modelId: string) => [modelId, 'openrouter/free'],
}))
vi.mock('@/server/conversations/http', () => ({ actEntitlementService: { gateModelPolicy: mocks.gate } }))
vi.mock('@/server/ai/model-policy-authority', () => ({ resolveAuthorizedModelIds: mocks.models }))
vi.mock('@/server/ai/model-runtime', () => ({ assertUserCanUseByokModel: mocks.byok }))
vi.mock('@/server/bootstrap', () => ({ getOverlayServerContext: () => ({
  workspaceService: { resolveActiveWorkspace: mocks.workspace },
  appData: { repositories: { conversations: { getLatestAgentRun: mocks.run } } },
  authorizationService: { resolveSubject: mocks.subject, checkResolvedCapability: mocks.capability,
    checkResolvedCatalogResourceAccess: mocks.catalog },
}) }))

const access: NativeHarnessAccess = {
  actorUserId: 'human', workspaceId: 'workspace', principalId: 'human-principal',
  agentId: 'agent', agentPrincipalId: 'agent-principal', conversationId: 'room',
  agentRunId: 'delivery', runId: 'workspace:delivery', workflowRunId: 'workflow',
  userMessageId: 'question', assistantMessageId: 'answer', turnId: 'turn',
}
const context: NativeHarnessContext = { modelId: 'fixture/model', memoryEnabled: true, sharedRoom: false, requestFingerprint: 'request' }
const snapshot = () => ({ ...createHarnessSnapshot({
  runId: access.runId, goal: 'Answer the question', constraints: [], policy: {
    actorUserId: access.actorUserId, workspaceId: access.workspaceId, allowedToolIds: ['read_file', 'call_mcp_tool'],
    requiresPlan: false, maxCostMicros: 1_000_000, deadlineAt: Date.now() + 60_000, maxDepth: 2, maxParallelChildren: 3,
  },
}, Date.now()), workflowRunId: access.workflowRunId })
const delivery = () => ({
  id: access.agentRunId, userId: access.actorUserId, conversationId: access.conversationId,
  agentId: access.agentId, agentPrincipalId: access.agentPrincipalId, turnId: access.turnId,
  userMessageId: access.userMessageId, assistantMessageId: access.assistantMessageId,
  harnessRunId: access.runId, workflowRunId: access.workflowRunId,
  runner: 'workflow', executionEngine: 'overlay_harness', mode: 'room', status: 'running',
})
const room = () => ({
  conversation: { workspaceId: 'workspace', conversationType: 'dm' }, conversationType: 'dm', latestUserText: 'Question',
  directory: { agents: [{ id: 'agent', principalId: 'agent-principal', harness: 'overlay', modelId: 'fixture/model', permissionMode: 'ask' }] },
  participants: [{ principalId: 'human-principal', principalType: 'human' }, { principalId: 'agent-principal', principalType: 'agent' }],
})

beforeEach(() => {
  vi.resetAllMocks()
  mocks.state.mockResolvedValue(snapshot())
  mocks.room.mockResolvedValue(room())
  mocks.run.mockResolvedValue(delivery())
  mocks.workspace.mockResolvedValue({ workspace: { id: 'workspace' }, principal: { id: 'human-principal' } })
  mocks.gate.mockResolvedValue({ paid: true, runtimeEntitlements: { planKind: 'pro' }, appSettings: { onlyAllowZdrModels: true } })
  mocks.subject.mockResolvedValue({ userId: 'human' })
  mocks.capability.mockReturnValue({ allowed: true })
  mocks.catalog.mockResolvedValue({ allowed: true })
  mocks.models.mockResolvedValue({ chat: new Set(['fixture/model', 'openrouter/free']) })
})

test('rechecks native identity and model policy without reserving or charging usage', async () => {
  const result = await refreshNativeHarnessAccess(access, context, 'read_file')
  expect(result).toMatchObject({ agent: { id: 'agent', permissionMode: 'ask' }, latestUserText: 'Question', paid: true, requiresZeroDataRetention: true })
  expect(mocks.gate).toHaveBeenCalledExactlyOnceWith({
    effectiveModelId: 'fixture/model', userId: 'human', workspaceId: 'workspace', programmaticSubjectId: 'agent:agent',
  })
  expect(mocks.workspace).toHaveBeenCalledWith('human', 'workspace')
  expect(mocks.room).toHaveBeenCalledWith(expect.objectContaining({ messageId: 'question', conversationId: 'room' }))
  expect(result).not.toHaveProperty('accessToken')
})

test('refuses legacy, foreign, cancelled and mismatched native delivery', async () => {
  for (const patch of [
    { executionEngine: undefined }, { userId: 'other' }, { agentPrincipalId: 'other' }, { status: 'cancelled' },
    { workflowRunId: 'other' }, { harnessRunId: 'other' }, { assistantMessageId: 'other' }, { userMessageId: 'other' },
  ]) {
    mocks.run.mockResolvedValueOnce({ ...delivery(), ...patch })
    await expect(refreshNativeHarnessAccess(access, context)).rejects.toThrow(/delivery/)
  }
  expect(mocks.gate).not.toHaveBeenCalled()
})

test('refuses revoked agents, participants, workspace identity and newly shared rooms', async () => {
  for (const patch of [{ harness: 'external' }, { archivedAt: 1 }, { principalId: 'other' }, { modelId: 'different/model' }]) {
    mocks.room.mockResolvedValueOnce({ ...room(), directory: { agents: [{ ...room().directory.agents[0], ...patch }] } })
    await expect(refreshNativeHarnessAccess(access, context)).rejects.toThrow()
  }
  for (const excluded of ['human', 'agent']) {
    mocks.room.mockResolvedValueOnce({ ...room(), participants: room().participants.filter(participant => participant.principalType !== excluded) })
    await expect(refreshNativeHarnessAccess(access, context)).rejects.toThrow(/participation/)
  }
  mocks.workspace.mockResolvedValueOnce({ workspace: { id: 'other' }, principal: { id: 'human-principal' } })
  await expect(refreshNativeHarnessAccess(access, context)).rejects.toThrow(/workspace identity/)
  const shared = { ...room(), participants: [...room().participants, { principalId: 'new-reader', principalType: 'human' }] }
  mocks.room.mockResolvedValue(shared)
  await expect(refreshNativeHarnessAccess(access, context)).rejects.toThrow(/private context/)
  await expect(refreshNativeHarnessAccess(access, { ...context, sharedRoom: true })).resolves.toMatchObject({ paid: true })
})

test('refuses stale execution, capabilities and model access before provider admission', async () => {
  for (const patch of [{ workflowRunId: 'other' }, { status: 'cancelled' }, { policy: { ...snapshot().policy, deadlineAt: 1 } }]) {
    mocks.state.mockResolvedValueOnce({ ...snapshot(), ...patch })
    await expect(refreshNativeHarnessAccess(access, context)).rejects.toThrow(/execution/)
  }
  await expect(refreshNativeHarnessAccess(access, context, 'ungranted')).rejects.toThrow(/capabilities/)
  mocks.capability.mockReturnValueOnce({ allowed: false })
  await expect(refreshNativeHarnessAccess(access, context)).rejects.toThrow(/permissions/)
  mocks.catalog.mockResolvedValueOnce({ allowed: false })
  await expect(refreshNativeHarnessAccess(access, context)).rejects.toThrow(/model permission/)
  mocks.models.mockResolvedValueOnce({ chat: new Set() })
  await expect(refreshNativeHarnessAccess(access, context)).rejects.toThrow(/server policy/)
})

test('only final tool progress may refresh authority after cancellation', async () => {
  mocks.state.mockResolvedValue({ ...snapshot(), status: 'cancelled' })
  mocks.run.mockResolvedValue({ ...delivery(), status: 'cancelled' })

  await expect(refreshNativeHarnessAccess(access, context, 'read_file', { allowCancelledToolProgress: true }))
    .resolves.toMatchObject({ runStatus: 'cancelled' })
  await expect(refreshNativeHarnessAccess(access, context, 'read_file')).rejects.toThrow(/no longer authorized/)
  await expect(refreshNativeHarnessAccess(access, context, undefined, { allowCancelledToolProgress: true }))
    .rejects.toThrow(/no longer authorized/)

  mocks.state.mockResolvedValue({ ...snapshot(), status: 'failed' })
  await expect(refreshNativeHarnessAccess(access, context, 'read_file', { allowCancelledToolProgress: true }))
    .rejects.toThrow(/no longer authorized/)
})

test('children can execute while their delivery waits, but cannot borrow a sibling delivery or outlive Stop', async () => {
  const child = { ...snapshot(), runId: 'child', parentRunId: access.runId, depth: 1, workflowRunId: 'child-workflow' }
  const childAccess = { ...access, runId: child.runId, workflowRunId: child.workflowRunId }
  const root = { ...snapshot(), status: 'waiting_for_children' }
  mocks.state.mockImplementation(async ({ runId }) => runId === child.runId ? child : root)
  mocks.run.mockResolvedValue({ ...delivery(), status: 'waiting_for_children' })
  await expect(refreshNativeHarnessAccess(childAccess, context)).resolves.toMatchObject({ paid: true })
  await expect(refreshNativeHarnessAccess({ ...childAccess, agentRunId: 'sibling' }, context)).rejects.toThrow(/descendant/)
  mocks.state.mockImplementation(async ({ runId }) => runId === child.runId ? child : { ...root, status: 'cancelled' })
  await expect(refreshNativeHarnessAccess(childAccess, context)).rejects.toThrow(/authorized/)
})

test('BYOK ownership is checked again for the selected agent model', async () => {
  const modelId = 'byok/connection/model'
  mocks.room.mockResolvedValue({ ...room(), directory: { agents: [{ ...room().directory.agents[0], modelId }] } })
  await refreshNativeHarnessAccess(access, { ...context, modelId })
  expect(mocks.byok).toHaveBeenCalledExactlyOnceWith(modelId, access.actorUserId)
  mocks.byok.mockRejectedValueOnce(new Error('Connection revoked'))
  await expect(refreshNativeHarnessAccess(access, { ...context, modelId })).rejects.toThrow(/revoked/)
})
