import { beforeEach, expect, test, vi } from 'vitest'
import { buildNativeHarnessWorkflowInput } from './native-workflow-input-builder'

const mocks = vi.hoisted(() => ({
  prepare: vi.fn(),
  prompt: vi.fn(),
  get: vi.fn(),
  inherited: vi.fn(),
  preAdmission: vi.fn(),
  server: {
    appData: { repositories: { conversations: { getLatestAgentRun: vi.fn() } } },
    chatUsagePolicy: { ensureBudgetNotLow: vi.fn() },
  },
}))

vi.mock('server-only', () => ({}))
vi.mock('@/server/bootstrap', () => ({ getOverlayServerContext: () => mocks.server }))
vi.mock('@/server/conversations/ActConversationRepository', () => ({ asConversationId: (id: string) => id }))
vi.mock('@/server/agents/workspace-agent-preparation', () => ({ prepareWorkspaceAgentInputs: mocks.prepare }))
vi.mock('@/server/agents/workspace-agent-invocation', () => ({ buildAgentSystemPrompt: mocks.prompt }))
vi.mock('./ConvexHarnessRepository', () => ({ ConvexHarnessRepository: class {
  get = mocks.get
  refreshRoomContextRestrictions = mocks.inherited
  resolveConversationRoomRestrictions = mocks.preAdmission
} }))

const run = {
  id: 'run', userId: 'user', conversationId: 'room', mode: 'room', runner: 'workflow',
  executionEngine: 'overlay_harness', initiatorPrincipalId: 'human-principal',
  agentId: 'agent', agentPrincipalId: 'agent-principal', userMessageId: 'question',
  assistantMessageId: 'answer', turnId: 'turn',
}

beforeEach(() => {
  vi.resetAllMocks()
  mocks.get.mockResolvedValue(null)
  mocks.inherited.mockResolvedValue({ inheritedSharedRoom: false })
  mocks.preAdmission.mockResolvedValue({ inheritedSharedRoom: false })
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
    inheritedSharedRoom: false,
  })
  expect(mocks.preAdmission).toHaveBeenCalledWith({
    actorUserId: 'user', workspaceId: 'workspace', conversationId: 'room',
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
  expect(input.definitions[0]).not.toHaveProperty('execute')
  expect(mocks.server.chatUsagePolicy.ensureBudgetNotLow).not.toHaveBeenCalled()
})

test('a new root in an assignment conversation resolves inherited restrictions before admission', async () => {
  mocks.preAdmission.mockResolvedValueOnce({ inheritedSharedRoom: true })
  mocks.server.appData.repositories.conversations.getLatestAgentRun.mockResolvedValueOnce({
    ...run, id: 'followup-run', conversationId: 'assignment-room',
  })
  await buildNativeHarnessWorkflowInput({
    actorUserId: 'user', workspaceId: 'workspace', conversationId: 'assignment-room',
    runId: 'followup-run', memoryEnabled: true,
  })
  expect(mocks.preAdmission).toHaveBeenCalledWith({
    actorUserId: 'user', workspaceId: 'workspace', conversationId: 'assignment-room',
  })
  expect(mocks.prepare).toHaveBeenCalledWith(expect.objectContaining({ inheritedSharedRoom: true }))
})

test('a shared persisted parent keeps a one-human assignment child on shared-only context', async () => {
  mocks.inherited.mockResolvedValue({ inheritedSharedRoom: true })
  mocks.server.appData.repositories.conversations.getLatestAgentRun.mockResolvedValue({
    ...run, id: 'child-run', conversationId: 'child-room', initiatorPrincipalId: 'caller-principal',
    harnessRunId: 'workspace:child-run',
  })
  mocks.prepare.mockResolvedValueOnce({
    room: {
      conversation: { workspaceId: 'workspace', title: 'Assignment' },
      conversationType: 'dm',
      participants: [
        { principalId: 'human-principal', principalType: 'human' },
        { principalId: 'agent-principal', principalType: 'agent' },
        { principalId: 'caller-principal', principalType: 'agent' },
      ],
      history: [{ _id: 'question', authorKind: 'agent', authorPrincipalId: 'caller-principal', content: 'Task' }],
    },
    agent: { id: 'agent', name: 'Scout', principalId: 'agent-principal', instructions: '', harness: 'overlay' },
    modelId: 'model-selected', requestFingerprint: 'fingerprint', turnId: 'turn',
    turnContext: { contextBlock: '', messages: [] }, toolDefinitions: [],
  })
  const input = await buildNativeHarnessWorkflowInput({
    actorUserId: 'user', workspaceId: 'workspace', conversationId: 'child-room',
    runId: 'child-run', parentRunId: 'workspace:parent-run', memoryEnabled: true,
  })
  expect(mocks.inherited).toHaveBeenCalledWith({
    actorUserId: 'user', runId: 'workspace:parent-run',
  })
  expect(mocks.prepare).toHaveBeenCalledWith(expect.objectContaining({ inheritedSharedRoom: true }))
  expect(input.context.sharedRoom).toBe(true)
})

test('rejects a stored triggering message with a different human principal', async () => {
  mocks.prepare.mockResolvedValueOnce({
    room: {
      conversation: { workspaceId: 'workspace', title: 'Room' },
      conversationType: 'channel', participants: [], history: [{ _id: 'question', authorKind: 'human', authorPrincipalId: 'foreign' }],
    },
    agent: { id: 'agent', name: 'Scout', principalId: 'agent-principal', instructions: '', harness: 'overlay' },
    modelId: 'model', requestFingerprint: 'fp', turnId: 'turn',
    turnContext: { contextBlock: '', messages: [] }, toolDefinitions: [],
  })
  await expect(buildNativeHarnessWorkflowInput({
    actorUserId: 'user', workspaceId: 'workspace', conversationId: 'room', runId: 'run', memoryEnabled: false,
  })).rejects.toThrow(/identity changed/)
  expect(mocks.prompt).not.toHaveBeenCalled()
})

test('confirmed existing roots refresh inherited restrictions', async () => {
  mocks.server.appData.repositories.conversations.getLatestAgentRun.mockResolvedValueOnce({
    ...run, harnessRunId: 'workspace:run',
  })
  mocks.get.mockResolvedValueOnce({ runId: 'workspace:run' })
  mocks.inherited.mockResolvedValueOnce({ inheritedSharedRoom: true })

  const input = await buildNativeHarnessWorkflowInput({
    actorUserId: 'user', workspaceId: 'workspace', conversationId: 'room', runId: 'run', memoryEnabled: true,
  })

  expect(mocks.get).toHaveBeenCalledWith({ actorUserId: 'user', runId: 'workspace:run' })
  expect(mocks.inherited).toHaveBeenCalledWith({ actorUserId: 'user', runId: 'workspace:run' })
  expect(mocks.preAdmission).not.toHaveBeenCalled()
  expect(mocks.prepare).toHaveBeenCalledWith(expect.objectContaining({ inheritedSharedRoom: true }))
  expect(input.context.sharedRoom).toBe(true)
})

test('a missing root still fails closed instead of falling back to conversation restrictions', async () => {
  mocks.server.appData.repositories.conversations.getLatestAgentRun.mockResolvedValueOnce({
    ...run, harnessRunId: 'workspace:missing',
  })
  mocks.get.mockResolvedValueOnce(null)
  mocks.inherited.mockRejectedValueOnce(new Error('HARNESS_RUN_NOT_FOUND'))

  await expect(buildNativeHarnessWorkflowInput({
    actorUserId: 'user', workspaceId: 'workspace', conversationId: 'room', runId: 'run', memoryEnabled: true,
  })).rejects.toThrow('HARNESS_RUN_NOT_FOUND')
  expect(mocks.preAdmission).not.toHaveBeenCalled()
})

test('an unauthorized existing root fails closed without pre-admission fallback', async () => {
  mocks.server.appData.repositories.conversations.getLatestAgentRun.mockResolvedValueOnce({
    ...run, harnessRunId: 'workspace:run',
  })
  mocks.get.mockRejectedValueOnce(new Error('HARNESS_RUN_ACCESS_DENIED'))

  await expect(buildNativeHarnessWorkflowInput({
    actorUserId: 'user', workspaceId: 'workspace', conversationId: 'room', runId: 'run', memoryEnabled: true,
  })).rejects.toThrow('HARNESS_RUN_ACCESS_DENIED')
  expect(mocks.inherited).not.toHaveBeenCalled()
  expect(mocks.preAdmission).not.toHaveBeenCalled()
})

test.each(['HARNESS_RUN_NOT_FOUND', 'HARNESS_RUN_ACCESS_DENIED'])(
  'a missing or unauthorized parent fails closed (%s)', async code => {
    mocks.inherited.mockRejectedValueOnce(new Error(code))

    await expect(buildNativeHarnessWorkflowInput({
      actorUserId: 'user', workspaceId: 'workspace', conversationId: 'room', runId: 'run',
      parentRunId: 'workspace:parent', memoryEnabled: true,
    })).rejects.toThrow(code)
    expect(mocks.inherited).toHaveBeenCalledWith({ actorUserId: 'user', runId: 'workspace:parent' })
    expect(mocks.preAdmission).not.toHaveBeenCalled()
  },
)
