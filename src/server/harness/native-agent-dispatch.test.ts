import { beforeEach, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(), resolve: vi.fn(), build: vi.fn(), get: vi.fn(), apply: vi.fn(), launch: vi.fn(),
  startTurn: vi.fn(), failMessage: vi.fn(), ask: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('./native-access', () => ({ refreshNativeHarnessAccess: mocks.refresh }))
vi.mock('./native-workflow-input-builder', () => ({ buildNativeHarnessWorkflowInput: mocks.build }))
vi.mock('./ConvexHarnessRepository', () => ({ ConvexHarnessRepository: class {
  get = mocks.get
  apply = mocks.apply
} }))
vi.mock('./native-named-child-launch', () => ({ startNativeHarnessNamedChild: mocks.launch }))
vi.mock('@/server/agents/workspace-agent-invocation', () => ({ resolveWorkspaceAgentInvocations: mocks.resolve }))
vi.mock('@/server/agents/agent-tooling', () => ({ buildWorkspaceAgentTooling: vi.fn() }))
vi.mock('@/server/conversations/personal-chat-work-tools', () => ({ executePersonalChatWorkToolResult: vi.fn() }))
vi.mock('@/server/bootstrap', () => ({
  getOverlayServerContext: () => ({
    appData: { repositories: { conversationCollaboration: {
      startAgentTurn: mocks.startTurn,
      failAgentMessage: mocks.failMessage,
    } } },
    agentAsks: { ask: mocks.ask, post: vi.fn() },
  }),
}))

import { dispatchNativeHarnessAgentRequest } from './native-tool-steps'

const access = {
  actorUserId: 'human', workspaceId: 'workspace', principalId: 'parent-principal',
  agentId: 'parent', agentPrincipalId: 'parent-principal', conversationId: 'parent-room',
  agentRunId: 'parent-run', userMessageId: 'parent-trigger', assistantMessageId: 'parent-reply',
  turnId: 'parent-turn', runId: 'workspace:parent-run', workflowRunId: 'parent-workflow',
}
const context = { modelId: 'model', memoryEnabled: true, sharedRoom: true, requestFingerprint: 'fingerprint' }
const parent = {
  runId: access.runId, workflowRunId: access.workflowRunId, policy: {
    actorUserId: access.actorUserId, workspaceId: access.workspaceId, allowedToolIds: ['read_file'], maxCostMicros: 100,
  }, usage: { costMicros: 0 }, children: [], revision: 1,
}
const invocation = {
  agentId: 'target', agentName: 'Target', agentPrincipalId: 'target-principal', invocationNonce: 'nonce',
  modelId: 'model', harness: 'overlay', externalAgent: false, turnId: 'target-turn',
}

beforeEach(() => {
  vi.resetAllMocks()
  mocks.refresh.mockResolvedValue({})
  mocks.resolve.mockResolvedValue([invocation])
  mocks.build.mockResolvedValue({
    access: { ...access, principalId: 'parent-principal', agentId: 'target', agentPrincipalId: 'target-principal',
      conversationId: 'target-room', agentRunId: 'target-run', userMessageId: 'question', assistantMessageId: 'answer',
      turnId: 'target-turn', runId: 'workspace:target-run' },
    context: { ...context, memoryEnabled: false },
    definitions: [
      { name: 'read_file', inputSchema: {}, needsApproval: false },
      { name: 'write_file', inputSchema: {}, needsApproval: false },
    ],
    instructions: 'instructions', messages: [],
  })
  mocks.get.mockResolvedValue(parent)
  mocks.apply.mockImplementation(async ({ operation }: { operation: { child: { id: string } } }) => ({
    conflict: false, snapshot: { children: [{ id: operation.child.id }] },
  }))
  mocks.startTurn.mockResolvedValue({ runId: 'target-run', messageId: 'answer', resumed: false })
  mocks.launch.mockResolvedValue('target-workflow')
  mocks.ask.mockImplementation(async (args: Record<string, unknown>) => {
    await (args.startTurns as (args: unknown) => Promise<unknown>)({
      actorUserId: 'human', conversationId: 'target-room', messageId: 'question',
      mentionedPrincipalIds: ['target-principal'], prompt: 'Asked by Parent: inspect this.', workspaceId: 'workspace',
    })
    return { status: 'working', turnId: 'target-turn' }
  })
})

test('native ask uses trusted caller, forces async delivery, intersects tools, and replays the named admission key', async () => {
  const first = await dispatchNativeHarnessAgentRequest(access, context, 'tool-call', 'ask_agent', {
    agent: 'Target', message: 'inspect this', wait: true,
  })
  const second = await dispatchNativeHarnessAgentRequest(access, context, 'tool-call', 'ask_agent', {
    agent: 'Target', message: 'inspect this', wait: true,
  })
  expect(first).toMatchObject({ status: 'working', childRunIds: ['workspace:target-run'] })
  expect(second).toMatchObject({ childRunIds: ['workspace:target-run'] })
  expect(mocks.ask).toHaveBeenNthCalledWith(1, expect.objectContaining({
    caller: { agentId: 'parent', conversationId: 'parent-room', turnId: 'parent-turn' },
    wait: false,
  }))
  expect(mocks.startTurn).toHaveBeenCalledWith(expect.objectContaining({
    executionEngine: 'overlay_harness', initiatorPrincipalId: 'parent-principal',
  }))
  const operation = mocks.apply.mock.calls[0]![0].operation
  expect(mocks.apply.mock.calls[0]![0].operationId).toBe('named-child:tool-call:target')
  expect(operation.child).toMatchObject({
    id: 'workspace:target-run', stepId: 'ask:tool-call:target', allowedToolIds: ['read_file'], maxCostMicros: 50,
  })
  await expect(mocks.build.mock.results[0]!.value).resolves.toMatchObject({ context: { memoryEnabled: false } })
  expect(mocks.launch).toHaveBeenCalledWith(access, expect.objectContaining({
    definitions: [{ name: 'read_file', inputSchema: {}, needsApproval: false }],
  }), 'workspace:target-run')
})

test('native ask splits the remaining budget across three targets while preserving a parent share', async () => {
  const invocations = ['one', 'two', 'three'].map(agentId => ({
    ...invocation, agentId, agentName: `Target ${agentId}`, agentPrincipalId: `${agentId}-principal`,
    invocationNonce: `nonce-${agentId}`, turnId: `turn-${agentId}`, modelId: 'paid/model',
  }))
  mocks.resolve.mockResolvedValueOnce(invocations)
  mocks.startTurn.mockImplementation(async ({ turnId }: { turnId: string }) => ({
    runId: turnId, messageId: `answer-${turnId}`, resumed: false,
  }))
  mocks.build.mockImplementation(async ({ runId }: { runId: string }) => ({
    access: { ...access, agentId: 'target', agentPrincipalId: 'target-principal', conversationId: 'target-room',
      agentRunId: runId, userMessageId: `question-${runId}`, assistantMessageId: `answer-${runId}`,
      turnId: runId, runId: `workspace:${runId}` },
    context: { ...context, memoryEnabled: false },
    definitions: [{ name: 'read_file', inputSchema: {}, needsApproval: false }],
    instructions: 'instructions', messages: [],
  }))
  await dispatchNativeHarnessAgentRequest(access, context, 'tool-call', 'ask_agent', {
    agent: 'Targets', message: 'inspect this', wait: true,
  })
  expect(mocks.apply.mock.calls.map(([args]) => args.operation.child.maxCostMicros)).toEqual([25, 25, 25])
})

test('free native routes reserve no child budget', async () => {
  mocks.resolve.mockResolvedValueOnce([{ ...invocation, modelId: 'openrouter/free' }])
  await dispatchNativeHarnessAgentRequest(access, context, 'tool-call', 'ask_agent', {
    agent: 'Target', message: 'inspect this', wait: true,
  })
  expect(mocks.apply.mock.calls[0]![0].operation.child.maxCostMicros).toBe(0)
})

test('native asks refuse external targets before creating a delivery', async () => {
  mocks.resolve.mockResolvedValueOnce([{ ...invocation, externalAgent: true, harness: 'claude-code' }])
  await expect(dispatchNativeHarnessAgentRequest(access, context, 'tool-call', 'ask_agent', {
    agent: 'External', message: 'inspect this',
  })).rejects.toThrow("External agents can't be asked from this run yet.")
  expect(mocks.startTurn).not.toHaveBeenCalled()
  expect(mocks.apply).not.toHaveBeenCalled()
})
