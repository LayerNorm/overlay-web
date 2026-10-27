import { beforeEach, expect, test, vi } from 'vitest'
import { startNativeHarnessTurn } from './native-turn-start'

const mocks = vi.hoisted(() => ({
  admit: vi.fn(),
  startWorkflow: vi.fn(),
  workflow: vi.fn(),
  server: { appData: { repositories: { conversations: {} } }, chatUsagePolicy: {} },
}))

vi.mock('server-only', () => ({}))
vi.mock('@/server/bootstrap', () => ({ getOverlayServerContext: () => mocks.server }))
vi.mock('@/server/conversations/ActEntitlementService', () => ({
  ActEntitlementService: class {
    gateModelAccess() { return Promise.resolve({ paid: true }) }
  },
}))
vi.mock('./native-workflow-input-builder', () => ({ buildNativeHarnessWorkflowInput: vi.fn() }))
vi.mock('./ConvexHarnessRepository', () => ({
  ConvexHarnessRepository: class {
    admit(input: unknown) { return mocks.admit(input) }
  },
}))
vi.mock('@/server/workflows/native-harness', () => ({ nativeHarnessWorkflow: mocks.workflow }))
vi.mock('workflow/api', () => ({ start: mocks.startWorkflow }))

const workflowInput = {
  access: {
    actorUserId: 'user', runId: 'workspace:agent-run', workspaceId: 'workspace', principalId: 'human-principal',
    agentId: 'agent', agentPrincipalId: 'agent-principal', conversationId: 'room', agentRunId: 'agent-run',
    userMessageId: 'question', assistantMessageId: 'answer', turnId: 'turn',
  },
  context: { modelId: 'openai/gpt-4.1', memoryEnabled: true, sharedRoom: true, requestFingerprint: 'fingerprint' },
  definitions: [
    { name: 'search_memory', inputSchema: { type: 'object', properties: {} } },
    { name: 'read_file', inputSchema: { type: 'object', properties: {} } },
  ],
  instructions: 'Instructions',
  messages: [{ role: 'user' as const, content: '  Make a plan  ' }],
}
const run = {
  id: 'agent-run', userId: 'user', conversationId: 'room', agentId: 'agent',
  agentPrincipalId: 'agent-principal', turnId: 'turn', userMessageId: 'question', assistantMessageId: 'answer',
  mode: 'room', runner: 'workflow', executionEngine: 'overlay_harness', createdAt: 100,
}

beforeEach(() => {
  vi.resetAllMocks()
  mocks.admit.mockResolvedValue({ runId: 'workspace:agent-run', status: 'running' })
  mocks.startWorkflow.mockResolvedValue({})
})

test('admits with the personal policy defaults and starts the native workflow with the built input', async () => {
  const admit = vi.fn().mockResolvedValue({ runId: 'workspace:agent-run', status: 'running' })
  const startWorkflow = vi.fn()
  await startNativeHarnessTurn({
    actorUserId: 'user', workspaceId: 'workspace', conversationId: 'room', runId: 'agent-run', memoryEnabled: true,
  }, {
    buildInput: async () => workflowInput as never,
    getAgentRun: async () => run as never,
    getPaid: async () => true,
    repository: { admit } as never,
    startWorkflow,
  })
  expect(admit).toHaveBeenCalledWith({
    runId: 'workspace:agent-run',
    goal: 'Make a plan',
    constraints: [],
    policy: {
      actorUserId: 'user', workspaceId: 'workspace', allowedToolIds: ['read_file', 'search_memory'],
      requiresPlan: false, deadlineAt: 86_400_100, maxCostMicros: 1_000_000,
      maxParallelChildren: 3, maxDepth: 2,
    },
    source: { conversationId: 'room' },
    deliveryAgentRunId: 'agent-run',
  })
  expect(startWorkflow).toHaveBeenCalledWith(mocks.workflow, [workflowInput])
})

test('a duplicate admission reconnects to the existing workflow without starting another', async () => {
  const admit = vi.fn().mockResolvedValue({
    runId: 'workspace:agent-run', status: 'running', workflowRunId: 'existing-workflow',
  })
  const startWorkflow = vi.fn()
  await startNativeHarnessTurn({
    actorUserId: 'user', workspaceId: 'workspace', conversationId: 'room', runId: 'agent-run', memoryEnabled: true,
  }, {
    buildInput: async () => workflowInput as never,
    getAgentRun: async () => run as never,
    getPaid: async () => true,
    repository: { admit } as never,
    startWorkflow,
  })
  expect(admit).toHaveBeenCalledTimes(1)
  expect(startWorkflow).not.toHaveBeenCalled()
})
