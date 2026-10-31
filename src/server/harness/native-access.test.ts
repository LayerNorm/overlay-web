import { beforeEach, expect, test, vi } from 'vitest'
import { createHarnessSnapshot } from '@overlay/agent-runtime/harness-state'
import { refreshNativeHarnessAccess, type NativeHarnessAccess, type NativeHarnessContext } from './native-access'

const mocks = vi.hoisted(() => ({
  state: vi.fn(), room: vi.fn(), workspace: vi.fn(), run: vi.fn(), gate: vi.fn(), subject: vi.fn(),
  surfaceExecution: vi.fn(), bindings: vi.fn(), conversation: vi.fn(),
  capability: vi.fn(), catalog: vi.fn(), models: vi.fn(), byok: vi.fn(),
}))
vi.mock('server-only', () => ({}))
vi.mock('./ConvexHarnessRepository', () => ({ ConvexHarnessRepository: class {
  get = mocks.state
  getSurfaceExecutionByHarnessRunId = mocks.surfaceExecution
} }))
vi.mock('@/server/agents/workspace-agent-invocation', () => ({
  loadRoomTurnContext: mocks.room, agentModelAttempts: (modelId: string) => [modelId, 'openrouter/free'],
}))
vi.mock('@/server/conversations/http', () => ({ actEntitlementService: { gateModelPolicy: mocks.gate } }))
vi.mock('@/server/ai/model-policy-authority', () => ({ resolveAuthorizedModelIds: mocks.models }))
vi.mock('@/server/ai/model-runtime', () => ({ assertUserCanUseByokModel: mocks.byok }))
vi.mock('@/server/bootstrap', () => ({ getOverlayServerContext: () => ({
  surfaceService: { resolveInboundBindings: mocks.bindings },
  workspaceService: { resolveActiveWorkspace: mocks.workspace },
  appData: { repositories: { conversations: {
    getLatestAgentRun: mocks.run,
    getConversationById: mocks.conversation,
  } } },
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
  agentId: access.agentId, agentPrincipalId: access.agentPrincipalId, initiatorPrincipalId: access.principalId,
  turnId: access.turnId,
  userMessageId: access.userMessageId, assistantMessageId: access.assistantMessageId,
  harnessRunId: access.runId, workflowRunId: access.workflowRunId,
  runner: 'workflow', executionEngine: 'overlay_harness', mode: 'room', status: 'running',
})
const room = () => ({
  conversation: { workspaceId: 'workspace', conversationType: 'dm' }, conversationType: 'dm', latestUserText: 'Question',
  directory: { agents: [{ id: 'agent', principalId: 'agent-principal', harness: 'overlay', modelId: 'fixture/model', permissionMode: 'ask' }] },
  participants: [{ principalId: 'human-principal', principalType: 'human' }, { principalId: 'agent-principal', principalType: 'agent' }],
})

function configureNamedChild(options: {
  initiatorPrincipalId?: string
  initiatorHarness?: string
  initiatorArchivedAt?: number
  includeInitiator?: boolean
} = {}) {
  const childRunId = 'workspace:child-delivery'
  const childWorkflowRunId = 'child-workflow'
  const childAgentPrincipalId = 'child-agent-principal'
  const initiatorPrincipalId = options.initiatorPrincipalId ?? 'asking-agent-principal'
  const childAccess: NativeHarnessAccess = {
    ...access,
    principalId: initiatorPrincipalId,
    agentId: 'child-agent',
    agentPrincipalId: childAgentPrincipalId,
    agentRunId: 'child-delivery',
    runId: childRunId,
    workflowRunId: childWorkflowRunId,
  }
  const parentState = snapshot()
  const childState = {
    ...snapshot(),
    runId: childRunId,
    rootRunId: parentState.runId,
    parentRunId: parentState.runId,
    depth: 1,
    workflowRunId: childWorkflowRunId,
  }
  mocks.state.mockImplementation(async ({ runId }: { runId: string }) => (
    runId === childRunId ? childState : parentState
  ))
  mocks.workspace.mockResolvedValue({
    workspace: { id: 'workspace' },
    principal: { id: 'human-principal', type: 'human' },
  })
  const childAgent = {
    id: 'child-agent',
    principalId: childAgentPrincipalId,
    harness: 'overlay',
    modelId: 'fixture/model',
    permissionMode: 'ask',
  }
  const initiatorAgent = {
    id: 'asking-agent',
    principalId: initiatorPrincipalId,
    harness: options.initiatorHarness ?? 'overlay',
    modelId: 'fixture/model',
    permissionMode: 'ask',
    ...(options.initiatorArchivedAt === undefined ? {} : { archivedAt: options.initiatorArchivedAt }),
  }
  const agents = [childAgent, ...(options.includeInitiator === false ? [] : [initiatorAgent])]
  const participants = [
    { principalId: 'human-principal', principalType: 'human' },
    { principalId: childAgentPrincipalId, principalType: 'agent' },
    ...(options.includeInitiator === false ? [] : [{ principalId: initiatorPrincipalId, principalType: 'agent' }]),
  ]
  mocks.room.mockResolvedValue({
    ...room(),
    directory: { agents },
    participants,
  })
  mocks.run.mockResolvedValue({
    ...delivery(),
    id: childAccess.agentRunId,
    agentId: childAccess.agentId,
    agentPrincipalId: childAccess.agentPrincipalId,
    harnessRunId: childRunId,
    workflowRunId: childWorkflowRunId,
    initiatorPrincipalId,
  })
  return childAccess
}

beforeEach(() => {
  vi.resetAllMocks()
  mocks.state.mockResolvedValue(snapshot())
  mocks.room.mockResolvedValue(room())
  mocks.run.mockResolvedValue(delivery())
  mocks.workspace.mockResolvedValue({
    workspace: { id: 'workspace' },
    principal: { id: 'human-principal', type: 'human' },
  })
  mocks.gate.mockResolvedValue({ paid: true, runtimeEntitlements: { planKind: 'pro' }, appSettings: { onlyAllowZdrModels: true } })
  mocks.subject.mockResolvedValue({ userId: 'human' })
  mocks.capability.mockReturnValue({ allowed: true })
  mocks.catalog.mockResolvedValue({ allowed: true })
  mocks.models.mockResolvedValue({ chat: new Set(['fixture/model', 'openrouter/free']) })
  mocks.surfaceExecution.mockResolvedValue(null)
  mocks.bindings.mockResolvedValue([])
  mocks.conversation.mockResolvedValue(null)
})

const surfaceExecution = {
  turnId: 'surface:slack:binding:message',
  workflowRunId: 'workflow',
  actorUserId: 'human',
  workspaceId: 'workspace',
  creatorPrincipalId: 'human-principal',
  agentId: 'agent',
  agentPrincipalId: 'agent-principal',
  platform: 'slack' as const,
  teamId: 'team',
  channelId: 'channel',
  threadId: 'thread',
  messageId: 'message',
  bindingId: 'binding',
  connectionId: 'connection',
  conversationId: 'room',
  agentRunId: 'delivery',
  userMessageId: 'question',
  assistantMessageId: 'answer',
  harnessRunId: 'workspace:delivery',
  createdAt: 100,
  updatedAt: 100,
}
const surfaceSource = {
  binding: { id: 'binding', connectionId: 'connection', channelId: 'channel', agentId: 'agent', status: 'active' },
  connection: { id: 'connection', platform: 'slack', externalTeamId: 'team', workspaceId: 'workspace', status: 'active' },
  agent: { id: 'agent', principalId: 'agent-principal', harness: 'overlay', allowedToolIds: [], permissionMode: 'ask' },
  creatorUserId: 'human',
  creatorPrincipalId: 'human-principal',
}
const surfaceConversation = {
  userId: 'human',
  workspaceId: 'workspace',
  conversationType: 'channel',
  createdByPrincipalId: 'human-principal',
  externalPlatform: 'slack',
  externalChannelId: 'channel',
  externalThreadId: 'thread',
  surfaceBindingId: 'binding',
}

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

test('allows a named child initiated by an Overlay agent in the room', async () => {
  const childAccess = configureNamedChild()

  await expect(refreshNativeHarnessAccess(childAccess, context))
    .resolves.toMatchObject({ agent: { id: 'child-agent' }, paid: true })
})

test('rejects a root run whose principal differs from the human workspace principal', async () => {
  await expect(refreshNativeHarnessAccess({ ...access, principalId: 'asking-agent-principal' }, context))
    .rejects.toThrow('Native workspace identity changed.')
})

test('rejects named children initiated by agents absent from the room, archived, non-native, or self', async () => {
  for (const options of [
    { includeInitiator: false },
    { initiatorArchivedAt: 1 },
    { initiatorHarness: 'external' },
    { initiatorPrincipalId: 'child-agent-principal' },
  ]) {
    const childAccess = configureNamedChild(options)
    await expect(refreshNativeHarnessAccess(childAccess, context))
      .rejects.toThrow('Native workspace identity changed.')
  }
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
  mocks.workspace.mockResolvedValueOnce({
    workspace: { id: 'other' },
    principal: { id: 'human-principal', type: 'human' },
  })
  await expect(refreshNativeHarnessAccess(access, context)).rejects.toThrow(/workspace identity/)
  mocks.workspace.mockResolvedValueOnce({
    workspace: { id: 'workspace' },
    principal: { id: 'human-principal', type: 'agent' },
  })
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

test('restored native dispatch revalidates the persisted root Slack source and bills its canonical subject', async () => {
  const surfaceAccess = { ...access, turnId: surfaceExecution.turnId }
  mocks.surfaceExecution.mockResolvedValue(surfaceExecution)
  mocks.bindings.mockResolvedValue([surfaceSource])
  mocks.conversation.mockResolvedValue(surfaceConversation)
  mocks.run.mockResolvedValue({ ...delivery(), turnId: surfaceExecution.turnId })

  const refreshed = await refreshNativeHarnessAccess(surfaceAccess, context, 'read_file')
  expect(refreshed.billingProgrammaticSubjectId).toBe('surface:slack:binding')
  expect(mocks.gate).toHaveBeenCalledWith(expect.objectContaining({
    programmaticSubjectId: 'surface:slack:binding',
  }))

  mocks.gate.mockClear()
  mocks.bindings.mockResolvedValueOnce([])
  await expect(refreshNativeHarnessAccess(surfaceAccess, context, 'read_file')).rejects.toThrow(/authorization changed/)
  expect(mocks.gate).not.toHaveBeenCalled()

  mocks.surfaceExecution.mockResolvedValueOnce({ ...surfaceExecution, workflowRunId: 'foreign-workflow' })
  mocks.state.mockResolvedValueOnce(snapshot())
  await expect(refreshNativeHarnessAccess(surfaceAccess, context)).rejects.toThrow(/source ownership changed/)
  expect(mocks.gate).not.toHaveBeenCalled()
})

test('named child keeps its native delivery identity while inheriting the verified root Slack source', async () => {
  const childAccess = configureNamedChild()
  mocks.surfaceExecution.mockResolvedValue(surfaceExecution)
  mocks.bindings.mockResolvedValue([surfaceSource])
  mocks.conversation.mockResolvedValue(surfaceConversation)
  const rootRun = { ...delivery(), turnId: surfaceExecution.turnId }
  const childRun = {
    ...delivery(),
    id: childAccess.agentRunId,
    agentId: childAccess.agentId,
    agentPrincipalId: childAccess.agentPrincipalId,
    harnessRunId: childAccess.runId,
    workflowRunId: childAccess.workflowRunId,
    initiatorPrincipalId: childAccess.principalId,
  }
  mocks.run.mockImplementation(async ({ agentRunId }: { agentRunId: string }) =>
    agentRunId === surfaceExecution.agentRunId ? rootRun : childRun)

  await expect(refreshNativeHarnessAccess(childAccess, context, 'read_file'))
    .resolves.toMatchObject({ agent: { id: 'child-agent' }, billingProgrammaticSubjectId: 'surface:slack:binding' })
  expect(mocks.surfaceExecution).toHaveBeenCalledWith(surfaceExecution.harnessRunId)
  expect(mocks.run).toHaveBeenCalledWith(expect.objectContaining({ agentRunId: surfaceExecution.agentRunId }))
  expect(mocks.gate).toHaveBeenCalledWith(expect.objectContaining({
    programmaticSubjectId: 'surface:slack:binding',
  }))
})
