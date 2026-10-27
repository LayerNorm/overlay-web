import { beforeEach, expect, test, vi } from 'vitest'
import { buildNativeHarnessWorkflowInput } from './native-workflow-input-builder'

const mocks = vi.hoisted(() => ({
  prepare: vi.fn(),
  prompt: vi.fn(),
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

const run = {
  id: 'run', userId: 'user', conversationId: 'room', mode: 'room', runner: 'workflow',
  executionEngine: 'overlay_harness', initiatorPrincipalId: 'human-principal',
  agentId: 'agent', agentPrincipalId: 'agent-principal', userMessageId: 'question',
  assistantMessageId: 'answer', turnId: 'turn',
}

beforeEach(() => {
  vi.resetAllMocks()
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
