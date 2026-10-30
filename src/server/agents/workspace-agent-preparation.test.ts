import { beforeEach, expect, test, vi } from 'vitest'
import { jsonSchema } from 'ai'
import { prepareWorkspaceAgentInputs } from './workspace-agent-preparation'

const mocks = vi.hoisted(() => ({
  buildContext: vi.fn(),
  buildTooling: vi.fn(),
  gate: vi.fn(),
  loadRoom: vi.fn(),
  sanitize: vi.fn((value: unknown) => value),
  server: {
    appData: { repositories: { conversations: {} } },
    chatUsagePolicy: { reserveForAttempt: vi.fn() },
  },
}))

vi.mock('server-only', () => ({}))
vi.mock('@/server/bootstrap', () => ({ getOverlayServerContext: () => mocks.server }))
vi.mock('@/server/conversations/ActEntitlementService', () => ({
  ActEntitlementService: class {
    gateModelAccess(input: unknown) { return mocks.gate(input) }
  },
}))
vi.mock('./workspace-agent-invocation', () => ({
  agentModelAttempts: () => ['model-primary', 'model-fallback'],
  loadRoomTurnContext: mocks.loadRoom,
}))
vi.mock('./agent-tooling', () => ({ buildWorkspaceAgentTooling: mocks.buildTooling }))
vi.mock('./agent-turn-context', () => ({ buildAgentTurnContext: mocks.buildContext }))
vi.mock('@/server/conversations/personal-chat-work-tools', () => ({
  sanitizeWorkflowToolSchemaValue: mocks.sanitize,
}))

const agent = {
  id: 'agent', name: 'Scout', principalId: 'agent-principal', modelId: 'model-primary',
  allowedToolIds: ['files'], permissionMode: 'ask', harness: 'overlay', instructions: 'Be helpful',
}

beforeEach(() => {
  vi.resetAllMocks()
  mocks.sanitize.mockImplementation((value: unknown) => value)
  mocks.loadRoom.mockResolvedValue({
    directory: { agents: [agent] },
    latestUserText: 'Read the file',
    history: [{ _id: 'question', authorKind: 'human', content: 'Read the file' }],
    conversation: { title: 'Room', channelVisibility: 'private' },
    conversationType: 'channel',
    participants: [{ principalId: 'human-principal', principalType: 'human' }],
  })
  mocks.gate.mockImplementation(async ({ effectiveModelId }: { effectiveModelId: string }) => {
    if (effectiveModelId === 'model-primary') throw new Error('not entitled')
    return { runtimeEntitlements: { tools: ['files'] }, paid: true }
  })
  mocks.buildTooling.mockResolvedValue({
    tools: {
      read_file: {
        description: 'Read a file',
        needsApproval: false,
        inputSchema: jsonSchema({ type: 'object', properties: { path: { type: 'string' } } }),
        execute: vi.fn(),
      },
    },
  })
  mocks.buildContext.mockResolvedValue({ contextBlock: 'Saved memory', messages: [{ role: 'user', content: 'Read the file' }] })
})

test('shared preparation retains model fallback, grants and schema only without reserving usage', async () => {
  const prepared = await prepareWorkspaceAgentInputs({
    actorUserId: 'user', agentId: 'agent', conversationId: 'room', messageId: 'question',
    memoryEnabled: true, workspaceId: 'workspace', includeAutoRetrieval: false,
  })
  expect(prepared.modelId).toBe('model-fallback')
  expect(prepared.modelCandidates).toEqual(['model-fallback'])
  expect(mocks.buildTooling).toHaveBeenCalledWith(expect.objectContaining({
    actorUserId: 'user', agentPrincipalId: 'agent-principal', conversationId: 'room',
    effectiveModelId: 'model-fallback', grant: { agentId: 'agent', allowedToolIds: ['files'], isDefaultMaster: false },
  }))
  expect(mocks.buildContext).toHaveBeenCalledWith(expect.objectContaining({ includeAutoRetrieval: false, memoryEnabled: true }))
  expect(prepared.toolDefinitions).toEqual([expect.objectContaining({
    name: 'read_file',
    needsApproval: false,
    inputSchema: { type: 'object', properties: { path: { type: 'string' } } },
  })])
  expect(prepared.toolDefinitions[0]).not.toHaveProperty('execute')
  expect(mocks.server.chatUsagePolicy.reserveForAttempt).not.toHaveBeenCalled()
})

 test('an entitled primary keeps its admitted fallback order', async () => {
  mocks.gate.mockResolvedValue({ runtimeEntitlements: { tools: ['files'] }, paid: true })
  const prepared = await prepareWorkspaceAgentInputs({
    actorUserId: 'user', agentId: 'agent', conversationId: 'room', messageId: 'question',
    memoryEnabled: true, workspaceId: 'workspace',
  })
  expect(prepared.modelId).toBe('model-primary')
  expect(prepared.modelCandidates).toEqual(['model-primary', 'model-fallback'])
 })
