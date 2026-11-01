import { beforeEach, expect, test, vi } from 'vitest'
import { buildNativeHarnessWorkflowInput } from './native-workflow-input-builder'

const mocks = vi.hoisted(() => ({
  prepare: vi.fn(),
  prompt: vi.fn(),
  surface: vi.fn(),
  assertSurface: vi.fn(),
  server: {
    appData: { repositories: { conversations: { getLatestAgentRun: vi.fn() } } },
    chatUsagePolicy: { reserveForAttempt: vi.fn() },
  },
}))

vi.mock('server-only', () => ({}))
vi.mock('@/server/bootstrap', () => ({ getOverlayServerContext: () => mocks.server }))
vi.mock('@/server/conversations/ActConversationRepository', () => ({ asConversationId: (id: string) => id }))
vi.mock('@/server/agents/workspace-agent-preparation', () => ({ prepareWorkspaceAgentInputs: mocks.prepare }))
vi.mock('@/server/agents/workspace-agent-invocation', () => ({ buildAgentSystemPrompt: mocks.prompt }))
vi.mock('./ConvexHarnessRepository', () => ({ ConvexHarnessRepository: class {
  getSurfaceExecutionByHarnessRunId = mocks.surface
} }))
vi.mock('./surface-access', () => ({ assertPersistedSurfaceSource: mocks.assertSurface }))

const run = {
  id: 'run', userId: 'user', conversationId: 'room', mode: 'room', runner: 'workflow',
  executionEngine: 'overlay_harness', initiatorPrincipalId: 'human-principal',
  agentId: 'agent', agentPrincipalId: 'agent-principal', userMessageId: 'question',
  assistantMessageId: 'answer', turnId: 'turn',
}

beforeEach(() => {
  vi.resetAllMocks()
  mocks.surface.mockResolvedValue(null)
  mocks.assertSurface.mockResolvedValue({})
  mocks.server.appData.repositories.conversations.getLatestAgentRun.mockResolvedValue(run)
  mocks.prepare.mockResolvedValue({
    room: {
      conversation: { workspaceId: 'workspace', title: 'Room', channelVisibility: 'public' },
      conversationType: 'channel',
      participants: [
        { principalId: 'human-principal', principalType: 'human' },
        { principalId: 'agent-principal', principalType: 'agent' },
      ],
      history: [{ _id: 'question', authorKind: 'human', authorPrincipalId: 'human-principal', content: 'Help' }],
    },
    agent: { id: 'agent', name: 'Scout', principalId: 'agent-principal', instructions: 'Be useful', harness: 'overlay' },
    modelId: 'model-selected',
    modelCandidates: ['model-selected', 'model-fallback'],
    requestFingerprint: 'fingerprint',
    turnId: 'turn',
    turnContext: { contextBlock: 'Saved memory', messages: [{ role: 'user', content: 'Help' }] },
    toolDefinitions: [{ name: 'read_file', needsApproval: false, inputSchema: { type: 'object', properties: {} } }],
  })
  mocks.prompt.mockReturnValue('Complete system prompt')
})

test('builds native input from the persisted delivery identity without reservation or executors', async () => {
  const input = await buildNativeHarnessWorkflowInput({
    actorUserId: 'user', workspaceId: 'workspace', conversationId: 'room', runId: 'run', memoryEnabled: true,
  })
  expect(mocks.server.appData.repositories.conversations.getLatestAgentRun).toHaveBeenCalledWith({
    agentRunId: 'run', conversationId: 'room', userId: 'user',
  })
  expect(mocks.prepare).toHaveBeenCalledWith({
    actorUserId: 'user', agentId: 'agent', conversationId: 'room', messageId: 'question',
    memoryEnabled: true, workspaceId: 'workspace', includeAutoRetrieval: false,
  })
  expect(input.access).toEqual({
    actorUserId: 'user', runId: 'workspace:run', workspaceId: 'workspace', principalId: 'human-principal',
    agentId: 'agent', agentPrincipalId: 'agent-principal', conversationId: 'room', agentRunId: 'run',
    userMessageId: 'question', assistantMessageId: 'answer', turnId: 'turn',
  })
  expect(input.context).toEqual({
    modelId: 'model-selected', memoryEnabled: true, sharedRoom: true, requestFingerprint: 'fingerprint',
  })
  expect(input.instructions).toBe('Complete system prompt')
  expect(input.modelCandidates).toEqual(['model-selected', 'model-fallback'])
  expect(input.definitions[0]).not.toHaveProperty('execute')
  expect(mocks.server.chatUsagePolicy.reserveForAttempt).not.toHaveBeenCalled()
})

test('rejects a stored triggering message with a different human principal', async () => {
  mocks.prepare.mockResolvedValueOnce({
    room: {
      conversation: { workspaceId: 'workspace', title: 'Room' },
      conversationType: 'channel', participants: [], history: [{ _id: 'question', authorKind: 'human', authorPrincipalId: 'foreign' }],
    },
    agent: { id: 'agent', name: 'Scout', principalId: 'agent-principal', instructions: '', harness: 'overlay' },
    modelId: 'model', modelCandidates: ['model'], requestFingerprint: 'fp', turnId: 'turn',
    turnContext: { contextBlock: '', messages: [] }, toolDefinitions: [],
  })
  await expect(buildNativeHarnessWorkflowInput({
    actorUserId: 'user', workspaceId: 'workspace', conversationId: 'room', runId: 'run', memoryEnabled: false,
  })).rejects.toThrow(/identity changed/)
  expect(mocks.prompt).not.toHaveBeenCalled()
})

test('surface root uses canonical source billing and preserves Slack context with the actual user task', async () => {
  const execution = {
    turnId: 'surface:slack:binding:message',
    workflowRunId: 'workflow',
    actorUserId: 'user',
    workspaceId: 'workspace',
    creatorPrincipalId: 'human-principal',
    agentId: 'agent',
    agentPrincipalId: 'agent-principal',
    platform: 'slack',
    teamId: 'team',
    channelId: 'channel',
    threadId: 'thread',
    messageId: 'message',
    bindingId: 'binding',
    connectionId: 'connection',
    conversationId: 'room',
    agentRunId: 'run',
    userMessageId: 'question',
    assistantMessageId: 'answer',
    harnessRunId: 'workspace:run',
  }
  mocks.surface.mockResolvedValue(execution)
  mocks.server.appData.repositories.conversations.getLatestAgentRun.mockResolvedValueOnce({
    ...run, turnId: execution.turnId,
  })

  await buildNativeHarnessWorkflowInput({
    actorUserId: 'user', workspaceId: 'workspace', conversationId: 'room', runId: 'run',
    memoryEnabled: true, expectedSurfaceWorkflowRunId: 'workflow',
  })
  expect(mocks.assertSurface).toHaveBeenCalledWith(execution, 'workflow')
  expect(mocks.prepare).toHaveBeenCalledWith(expect.objectContaining({
    turnIdOverride: execution.turnId,
    requestFingerprintOverride: `surface:${execution.turnId}`,
    billingProgrammaticSubjectId: 'surface:slack:binding',
  }))
  expect(mocks.prompt).toHaveBeenCalledWith(expect.objectContaining({
    contextBlock: expect.stringContaining('This request arrived through Slack'),
  }))
  expect(mocks.prepare.mock.calls[0]?.[0].messageId).toBe('question')
})

test('named native child in a different room keeps its turn and inherits verified root source billing', async () => {
  const execution = {
    turnId: 'surface:slack:binding:message',
    workflowRunId: 'workflow',
    actorUserId: 'user',
    workspaceId: 'workspace',
    conversationId: 'room',
    bindingId: 'binding',
    agentRunId: 'run',
    userMessageId: 'question',
    assistantMessageId: 'answer',
    harnessRunId: 'workspace:run',
  }
  mocks.surface.mockResolvedValue(execution)
  mocks.server.appData.repositories.conversations.getLatestAgentRun.mockResolvedValueOnce({
    ...run,
    id: 'child-run',
    conversationId: 'child-room',
    agentId: 'child-agent',
    agentPrincipalId: 'child-principal',
    initiatorPrincipalId: 'parent-principal',
    turnId: 'child-turn',
    userMessageId: 'child-question',
    assistantMessageId: 'child-answer',
  })
  mocks.prepare.mockResolvedValueOnce({
    room: {
      conversation: { workspaceId: 'workspace', title: 'Room' },
      conversationType: 'channel',
      participants: [{ principalId: 'human-principal', principalType: 'human' }],
      history: [{ _id: 'child-question', authorKind: 'agent', authorPrincipalId: 'parent-principal', content: 'Child task' }],
    },
    agent: { id: 'child-agent', name: 'Child', principalId: 'child-principal', instructions: '', harness: 'overlay' },
    modelId: 'model', modelCandidates: ['model'], requestFingerprint: 'child-fingerprint', turnId: 'child-turn',
    turnContext: { contextBlock: 'Parent source context', messages: [{ role: 'user', content: 'Child task' }] },
    toolDefinitions: [],
  })

  const result = await buildNativeHarnessWorkflowInput({
    actorUserId: 'user', workspaceId: 'workspace', conversationId: 'child-room', runId: 'child-run',
    memoryEnabled: true, surfaceRootRunId: 'workspace:run', expectedSurfaceWorkflowRunId: 'workflow',
  })
  expect(mocks.surface).toHaveBeenCalledWith('workspace:run')
  expect(mocks.assertSurface).toHaveBeenCalledWith(execution, 'workflow')
  expect(mocks.prepare.mock.calls[0]?.[0]).not.toHaveProperty('turnIdOverride')
  expect(mocks.prepare.mock.calls[0]?.[0]).toMatchObject({ billingProgrammaticSubjectId: 'surface:slack:binding' })
  expect(result.access.turnId).toBe('child-turn')
  expect(result.access.agentId).toBe('child-agent')
})
