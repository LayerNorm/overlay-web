import { beforeEach, expect, test, vi } from 'vitest'
import { ConvexError } from 'convex/values'

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(), resolve: vi.fn(), build: vi.fn(), get: vi.fn(), apply: vi.fn(), launch: vi.fn(),
  startTurn: vi.fn(), failMessage: vi.fn(), ask: vi.fn(), list: vi.fn(), directory: vi.fn(),
  remoteTarget: vi.fn(), bindings: vi.fn(),
  resolveAssignment: vi.fn(), cancel: vi.fn(), cancelSubtree: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('./native-access', () => ({ refreshNativeHarnessAccess: mocks.refresh }))
vi.mock('./native-workflow-input-builder', () => ({ buildNativeHarnessWorkflowInput: mocks.build }))
vi.mock('./ConvexHarnessRepository', () => ({ ConvexHarnessRepository: class {
  get = mocks.get
  apply = mocks.apply
  resolveAssignment = mocks.resolveAssignment
} }))
vi.mock('./workflow-cancellation', () => ({ cancelHarnessWorkflow: mocks.cancel }))
vi.mock('./personal-cancellation', () => ({ cancelPersonalHarnessWorkflows: mocks.cancelSubtree }))
vi.mock('./native-named-child-launch', () => ({ startNativeHarnessNamedChild: mocks.launch }))
vi.mock('@/server/agents/workspace-agent-invocation', () => ({ resolveWorkspaceAgentInvocations: mocks.resolve }))
vi.mock('@/server/agents/agent-tooling', () => ({ buildWorkspaceAgentTooling: vi.fn() }))
vi.mock('@/server/conversations/personal-chat-work-tools', () => ({ executePersonalChatWorkToolResult: vi.fn() }))
vi.mock('@/server/bootstrap', () => ({
  getOverlayServerContext: () => ({
    appData: { repositories: { conversationCollaboration: {
      startAgentTurn: mocks.startTurn,
      failAgentMessage: mocks.failMessage,
    }, connectedAgents: {
      findInvocationTarget: mocks.remoteTarget, listBindings: mocks.bindings,
    } } },
    workspaceAgentService: { list: mocks.directory },
    agentAsks: { ask: mocks.ask, list: mocks.list, post: vi.fn() },
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
  runId: access.runId, rootRunId: access.runId, workflowRunId: access.workflowRunId, policy: {
    actorUserId: access.actorUserId, workspaceId: access.workspaceId, allowedToolIds: ['read_file'], maxCostMicros: 0,
  }, usage: { costMicros: 0 }, children: [], revision: 1,
}
const invocation = {
  agentId: 'target', agentName: 'Target', agentPrincipalId: 'target-principal', invocationNonce: 'nonce',
  modelId: 'model', harness: 'overlay', externalAgent: false, turnId: 'target-turn',
}

beforeEach(() => {
  vi.resetAllMocks()
  mocks.refresh.mockResolvedValue({})
  mocks.list.mockResolvedValue([])
  mocks.directory.mockResolvedValue({ agents: [{ ...invocation, id: 'target', name: 'Target' }] })
  mocks.remoteTarget.mockResolvedValue(null)
  mocks.bindings.mockResolvedValue([])
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
    nativeAssignment: { parentRunId: 'forged', rootRunId: 'forged', toolCallId: 'forged' },
    actorUserId: 'forged', actorPrincipalId: 'forged', principalId: 'forged', runId: 'forged',
  })
  const second = await dispatchNativeHarnessAgentRequest(access, context, 'tool-call', 'ask_agent', {
    agent: 'Target', message: 'inspect this', wait: true,
  })
  expect(first).toMatchObject({ status: 'working', childRunIds: ['workspace:target-run'] })
  expect(second).toMatchObject({ childRunIds: ['workspace:target-run'] })
  expect(mocks.ask).toHaveBeenNthCalledWith(1, expect.objectContaining({
    caller: { agentId: 'parent', conversationId: 'parent-room', turnId: 'parent-turn' },
    actorUserId: 'human', actorPrincipalId: 'parent-principal',
    nativeAssignment: expect.objectContaining({
      parentConversationId: 'parent-room', parentRunId: access.runId, rootRunId: parent.rootRunId, toolCallId: 'tool-call',
    }),
    wait: false,
  }))
  expect(mocks.startTurn).toHaveBeenCalledWith(expect.objectContaining({
    executionEngine: 'overlay_harness', initiatorPrincipalId: 'parent-principal',
  }))
  const operation = mocks.apply.mock.calls[0]![0].operation
  expect(mocks.apply.mock.calls[0]![0].operationId).toBe('named-child:tool-call:target')
  expect(operation.child).toMatchObject({
    id: 'workspace:target-run', stepId: 'ask:tool-call:target', allowedToolIds: ['read_file'], maxCostMicros: 0,
  })
  await expect(mocks.build.mock.results[0]!.value).resolves.toMatchObject({ context: { memoryEnabled: false } })
  expect(mocks.launch).toHaveBeenCalledWith(access, expect.objectContaining({
    definitions: [{ name: 'read_file', inputSchema: {}, needsApproval: false }],
  }), 'workspace:target-run')
})

test('native surface trigger is passed only for the matching persisted root, never a child or unrelated run', async () => {
  const surfaceExecution = {
    actorUserId: access.actorUserId,
    workspaceId: access.workspaceId,
    creatorPrincipalId: access.principalId,
    agentId: access.agentId,
    agentPrincipalId: access.agentPrincipalId,
    conversationId: access.conversationId,
    agentRunId: access.agentRunId,
    userMessageId: access.userMessageId,
    assistantMessageId: access.assistantMessageId,
    turnId: access.turnId,
    harnessRunId: access.runId,
    workflowRunId: access.workflowRunId,
    platform: 'slack',
    teamId: 'team',
    channelId: 'channel',
    threadId: 'thread',
    messageId: 'slack-message',
    bindingId: 'binding',
    connectionId: 'connection',
    createdAt: 1,
    updatedAt: 1,
  }
  mocks.refresh.mockResolvedValue({ surfaceExecution, sharedRoom: true })
  mocks.ask.mockResolvedValue({ status: 'working' })

  await dispatchNativeHarnessAgentRequest(access, context, 'root-call', 'ask_agent', {
    agent: 'Target', message: 'inspect', nativeSurfaceTrigger: { userMessageId: 'forged' }, sharedSurfaceContext: null,
  })
  expect(mocks.ask).toHaveBeenNthCalledWith(1, expect.objectContaining({
    nativeSurfaceTrigger: surfaceExecution, sharedSurfaceContext: { surfaceExecution },
  }))

  const childAccess = {
    ...access,
    agentId: 'child-agent',
    agentPrincipalId: 'child-principal',
    agentRunId: 'child-run',
    userMessageId: 'child-trigger',
    assistantMessageId: 'child-reply',
    turnId: 'child-turn',
    runId: 'workspace:child-run',
    workflowRunId: 'child-workflow',
  }
  const unrelatedAccess = {
    ...access,
    agentId: 'unrelated-agent',
    agentPrincipalId: 'unrelated-principal',
    agentRunId: 'unrelated-run',
    userMessageId: 'unrelated-trigger',
    assistantMessageId: 'unrelated-reply',
    turnId: 'unrelated-turn',
    runId: 'workspace:unrelated-run',
    workflowRunId: 'unrelated-workflow',
  }
  const childParent = { ...parent, runId: childAccess.runId, rootRunId: access.runId, workflowRunId: childAccess.workflowRunId }
  const unrelatedParent = { ...parent, runId: unrelatedAccess.runId, rootRunId: unrelatedAccess.runId,
    workflowRunId: unrelatedAccess.workflowRunId }
  mocks.get.mockImplementation(async ({ runId }: { runId: string }) =>
    runId === childAccess.runId ? childParent : runId === unrelatedAccess.runId ? unrelatedParent : parent)
  mocks.refresh.mockImplementation(async ({ runId }: { runId: string }) => ({
    ...(runId === unrelatedAccess.runId ? {} : { surfaceExecution }), sharedRoom: true,
  }))

  await dispatchNativeHarnessAgentRequest(childAccess, context, 'child-call', 'ask_agent', {
    agent: 'Target', message: 'inspect', nativeSurfaceTrigger: { userMessageId: 'forged-child' }, sharedSurfaceContext: null,
  })
  await dispatchNativeHarnessAgentRequest(unrelatedAccess, context, 'unrelated-call', 'ask_agent', {
    agent: 'Target', message: 'inspect', nativeSurfaceTrigger: { userMessageId: 'forged-unrelated' },
  })
  expect(mocks.ask).toHaveBeenNthCalledWith(2, expect.objectContaining({
    nativeSurfaceTrigger: undefined, sharedSurfaceContext: { surfaceExecution },
  }))
  expect(mocks.ask).toHaveBeenNthCalledWith(3, expect.objectContaining({
    nativeSurfaceTrigger: undefined, sharedSurfaceContext: undefined,
  }))
})

test('shared-surface list uses the verified root context and ignores tool-supplied policy fields', async () => {
  const surfaceExecution = { harnessRunId: access.runId, workflowRunId: access.workflowRunId } as never
  mocks.refresh.mockResolvedValue({ surfaceExecution, sharedRoom: true })
  mocks.list.mockResolvedValue([{
    id: 'workspace-agent', name: 'Workspace agent', description: 'Handles shared work', kind: 'Overlay agent',
  }])

  const result = await dispatchNativeHarnessAgentRequest(access, context, 'list-call', 'list_agents', {
    sharedSurfaceContext: null, workspaceVisibleOnly: false, surfaceExecution: null,
  })

  expect(result).toEqual({ success: true, agents: [{
    id: 'workspace-agent', name: 'Workspace agent', description: 'Handles shared work', kind: 'Overlay agent',
  }] })
  expect(mocks.list).toHaveBeenCalledWith({
    actorUserId: access.actorUserId, workspaceId: access.workspaceId, callerAgentId: access.agentId,
    sharedSurfaceContext: { surfaceExecution },
  })

  mocks.refresh.mockResolvedValue({ surfaceExecution, sharedRoom: false })
  await dispatchNativeHarnessAgentRequest(access, context, 'private-list-call', 'list_agents', {
    sharedSurfaceContext: { surfaceExecution }, workspaceVisibleOnly: true,
  })
  expect(mocks.list).toHaveBeenNthCalledWith(2, {
    actorUserId: access.actorUserId, workspaceId: access.workspaceId, callerAgentId: access.agentId,
    sharedSurfaceContext: undefined,
  })
})

test('shared-surface descendant revalidates targets before creating named child runs', async () => {
  const surfaceExecution = { harnessRunId: access.runId, workflowRunId: access.workflowRunId } as never
  mocks.refresh.mockResolvedValue({ surfaceExecution, sharedRoom: true })
  mocks.resolve.mockResolvedValue([])

  await dispatchNativeHarnessAgentRequest(access, context, 'nested-ask', 'ask_agent', {
    agent: 'Target', message: 'inspect', sharedSurfaceContext: null,
  })

  expect(mocks.resolve).toHaveBeenCalledWith(expect.objectContaining({
    actorUserId: access.actorUserId, workspaceId: access.workspaceId,
  }), { sharedSurfaceContext: { surfaceExecution } })
  expect(mocks.startTurn).not.toHaveBeenCalled()
  expect(mocks.apply).not.toHaveBeenCalled()
  expect(mocks.launch).not.toHaveBeenCalled()
})

test('native ask gives every target the same workspace budget with no per-child split', async () => {
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
  expect(mocks.apply.mock.calls.map(([args]) => args.operation.child.maxCostMicros)).toEqual([0, 0, 0])
})

test('a descendant dispatch uses the original root workflow for surface preparation', async () => {
  const root = { ...parent, runId: 'workspace:source', rootRunId: 'workspace:source', workflowRunId: 'source-workflow' }
  mocks.get.mockImplementation(async ({ runId }) => runId === root.runId ? root : { ...parent, rootRunId: root.runId })
  await dispatchNativeHarnessAgentRequest(access, context, 'tool-call', 'ask_agent', {
    agent: 'Target', message: 'inspect this',
  })
  expect(mocks.build).toHaveBeenCalledWith(expect.objectContaining({
    conversationId: 'target-room', surfaceRootRunId: root.runId, expectedSurfaceWorkflowRunId: 'source-workflow',
  }))
})

test('native asks reject external directory targets before asking or creating a delivery', async () => {
  mocks.directory.mockResolvedValue({ agents: [{ ...invocation, id: 'external', name: 'External', harness: 'claude-code' }] })
  await expect(dispatchNativeHarnessAgentRequest(access, context, 'tool-call', 'ask_agent', {
    agent: 'External', message: 'inspect this',
  })).rejects.toThrow("External agents can't be asked from this run yet.")
  expect(mocks.ask).not.toHaveBeenCalled()
  expect(mocks.startTurn).not.toHaveBeenCalled()
  expect(mocks.apply).not.toHaveBeenCalled()
})

test('native asks reject remote bindings before asking or creating an assignment', async () => {
  mocks.bindings.mockResolvedValue([{ bindingId: 'remote-binding' }])
  await expect(dispatchNativeHarnessAgentRequest(access, context, 'tool-call', 'ask_agent', {
    agent: 'Target', message: 'inspect this',
  })).rejects.toThrow("External agents can't be asked from this run yet.")
  expect(mocks.ask).not.toHaveBeenCalled()
  expect(mocks.startTurn).not.toHaveBeenCalled()
  expect(mocks.apply).not.toHaveBeenCalled()
})

test('assignment resolution uses trusted execution identity and the existing cancellation machinery', async () => {
  const cancellationRoot = { actorUserId: access.actorUserId, agentRunId: 'child-delivery', rootRunId: 'workspace:child-delivery' }
  mocks.resolveAssignment.mockResolvedValue({ assignmentId: 'assignment', attemptId: 'attempt', disposition: 'excluded',
    reason: 'Not needed', workflows: ['child-workflow'], cancellationRoot })
  expect(await dispatchNativeHarnessAgentRequest(access, context, 'resolve', 'resolve_assignment', { assignmentId: 'assignment', attemptId: 'attempt',
    action: 'cancel', reason: 'Not needed', actorUserId: 'forged', parentRunId: 'forged', workflowRunId: 'forged' })).toMatchObject({ disposition: 'excluded' })
  expect(mocks.resolveAssignment).toHaveBeenCalledWith({ actorUserId: access.actorUserId, workspaceId: access.workspaceId,
    parentRunId: access.runId, workflowRunId: access.workflowRunId, executionGeneration: 0,
    assignmentId: 'assignment', attemptId: 'attempt', action: 'cancel', reason: 'Not needed' })
  expect(mocks.cancel).toHaveBeenCalledWith('child-workflow')
  expect(mocks.cancelSubtree).toHaveBeenCalledWith(cancellationRoot)
  expect(mocks.ask).not.toHaveBeenCalled()
})

test.each([{}, { assignmentId: 'assignment', attemptId: 'attempt', action: 'grade' }])('invalid resolutions cannot invoke the repository: %j', async input => {
  await expect(dispatchNativeHarnessAgentRequest(access, context, 'resolve', 'resolve_assignment', input)).rejects.toThrow('Invalid assignment resolution')
  expect(mocks.resolveAssignment).not.toHaveBeenCalled()
})

test.each([undefined, 'current-attempt'])('confirmed resolution rejection returns corrective feedback with only authorized handles: %s', async currentAttemptId => {
  const feedback = { code: 'ASSIGNMENT_RESOLUTION_REJECTED', error: 'ASSIGNMENT_ATTEMPT_NOT_FOUND',
    hint: 'Use the current attempt ID.', ...(currentAttemptId ? { currentAttemptId } : {}) }
  mocks.resolveAssignment.mockRejectedValue(new ConvexError(feedback))
  expect(await dispatchNativeHarnessAgentRequest(access, context, 'resolve', 'resolve_assignment', {
    assignmentId: 'assignment', attemptId: 'malformed', action: 'exclude', reason: 'Superseded',
  })).toEqual({ success: false, ...feedback })
  expect(mocks.cancel).not.toHaveBeenCalled()
})

test('unconfirmed resolution failures retain the uncertain-outcome path', async () => {
  mocks.resolveAssignment.mockRejectedValue(new Error('Connection interrupted'))
  await expect(dispatchNativeHarnessAgentRequest(access, context, 'resolve', 'resolve_assignment', {
    assignmentId: 'assignment', attemptId: 'attempt', action: 'exclude', reason: 'Superseded',
  })).rejects.toThrow('Connection interrupted')
})
