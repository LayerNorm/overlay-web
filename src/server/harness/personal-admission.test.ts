import { beforeEach, expect, test, vi } from 'vitest'
import type { AgentRun } from '@/shared/agents/agent-run'
import type { AuthenticatedAppUser } from '@/server/auth/app-api-auth'
import type { HarnessSnapshot } from '@overlay/agent-runtime/harness-state'
import type { PersonalHarnessWorkflowInput } from './personal-workflow-input'
import {
  PersonalHarnessAdmissionConflict,
  PersonalHarnessStartPending,
  personalHarnessAuthentication,
  startPersonalHarness,
} from './personal-admission'

const mocks = vi.hoisted(() => ({
  admit: vi.fn(),
  get: vi.fn(),
  getRun: vi.fn(),
  start: vi.fn(),
  delay: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('node:timers/promises', () => ({ setTimeout: mocks.delay }))
vi.mock('workflow/api', () => ({ getRun: mocks.getRun, start: mocks.start }))
vi.mock('@/server/workflows/personal-harness', () => ({ personalHarnessWorkflow: vi.fn() }))
vi.mock('./ConvexHarnessRepository', () => ({
  ConvexHarnessRepository: class {
    admit = mocks.admit
    get = mocks.get
  },
}))

const workflow: PersonalHarnessWorkflowInput = {
  access: {
    actorUserId: 'user',
    runId: 'personal:run_1',
    conversationId: 'conversation',
    agentRunId: 'run_1',
    workspaceId: 'workspace',
    principalId: 'principal',
    authentication: { type: 'session' },
  },
  context: {
    userId: 'user',
    workspaceId: 'workspace',
    conversationId: 'conversation',
    effectiveModelId: 'fixture/model',
    baseUrl: 'https://example.test',
    memoryEnabled: false,
    requestedToolIds: ['read'],
    turnId: 'turn_1',
    requestFingerprint: 'request',
  },
  definitions: [{ name: 'read', inputSchema: { type: 'object' }, needsApproval: false }],
  instructions: 'Use the available tools safely.',
  messages: [{ role: 'user', content: 'Read the source.' }],
  delivery: { emitWebhook: true },
}

const agentRun = (overrides: Partial<AgentRun> = {}): AgentRun => ({
  id: 'run_1',
  conversationId: 'conversation',
  turnId: 'turn_1',
  userId: 'user',
  userMessageId: 'message',
  assistantMessageId: 'assistant',
  mode: 'chat',
  runner: 'workflow',
  executionEngine: 'overlay_harness',
  status: 'queued',
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_000_000,
  ...overrides,
} as AgentRun)

const snapshot = (overrides: Partial<HarnessSnapshot> = {}) => ({
  runId: 'personal:run_1',
  status: 'running',
  revision: 0,
  ...overrides,
}) as HarnessSnapshot

beforeEach(() => {
  vi.resetAllMocks()
  mocks.admit.mockResolvedValue(snapshot())
  mocks.get.mockResolvedValue(snapshot({ workflowRunId: 'winning-workflow' }))
  mocks.getRun.mockImplementation(async id => ({ runId: id }))
  mocks.start.mockImplementation(async () => ({ runId: 'losing-workflow' }))
  mocks.delay.mockResolvedValue(undefined)
})

test('admits immutable identity and policy before starting the personal workflow', async () => {
  const onAdmitted = vi.fn()
  await startPersonalHarness({
    workflow,
    agentRun: agentRun(),
    paid: true,
    goal: '  Read the source.  ',
    budget: { durationMs: 60_000 },
    onAdmitted,
  })

  expect(mocks.admit).toHaveBeenCalledWith(expect.objectContaining({
    runId: 'personal:run_1',
    goal: 'Read the source.',
    source: { conversationId: 'conversation' },
    deliveryAgentRunId: 'run_1',
    policy: expect.objectContaining({
      actorUserId: 'user',
      workspaceId: 'workspace',
      allowedToolIds: ['read'],
      executionPolicyVersion: 2,
      spendingMode: 'workspace',
      taskDeadlineAt: 1_700_000_060_000,
      maxCostMicros: 0,
    }),
  }))
  expect(onAdmitted).toHaveBeenCalledOnce()
  expect(mocks.start).toHaveBeenCalledOnce()
  expect(mocks.getRun).toHaveBeenCalledWith('winning-workflow')
})

test('chat runs persisted with ask labels admit both generated UI tools for form requests', async () => {
  await startPersonalHarness({
    workflow: { ...workflow, definitions: ['render_ui', 'present_generated_ui'].map(name => ({ name, inputSchema: { type: 'object' }, needsApproval: false })) },
    agentRun: agentRun({ mode: 'chat' }), paid: true, goal: 'Show a bound bug report form.',
  })
  expect(mocks.admit).toHaveBeenCalledWith(expect.objectContaining({
    policy: expect.objectContaining({ allowedToolIds: ['present_generated_ui', 'render_ui'] }),
  }))
})

test('a claimed duplicate returns the canonical workflow without starting another', async () => {
  mocks.admit.mockResolvedValue(snapshot({ workflowRunId: 'canonical-workflow' }))

  expect(await startPersonalHarness({ workflow, agentRun: agentRun({ harnessRunId: 'personal:run_1' }), paid: true, goal: 'Read.' }))
    .toEqual({ runId: 'canonical-workflow' })
  expect(mocks.start).not.toHaveBeenCalled()
  expect(mocks.getRun).toHaveBeenCalledWith('canonical-workflow')
})

test('versioned admission returns its durable root handle without exposing a workflow handle', async () => {
  mocks.get.mockResolvedValue(snapshot())
  mocks.admit.mockResolvedValue(snapshot({
    policy: { publicStreamVersion: 1 },
    executionGeneration: 3,
  }))

  await expect(startPersonalHarness({ workflow, agentRun: agentRun(), paid: true, goal: 'Read.' }))
    .resolves.toEqual({ accepted: true, runId: 'personal:run_1', executionGeneration: 3 })
  expect(mocks.start).toHaveBeenCalledOnce()
  expect(mocks.getRun).not.toHaveBeenCalled()
})

test('a versioned existing winner reconnects to the root without starting another workflow', async () => {
  mocks.admit.mockResolvedValue(snapshot({
    workflowRunId: 'canonical-workflow',
    policy: { publicStreamVersion: 1 },
    executionGeneration: 4,
  }))

  await expect(startPersonalHarness({
    workflow, agentRun: agentRun({ harnessRunId: 'personal:run_1' }), paid: true, goal: 'Read.',
  })).resolves.toEqual({ accepted: true, runId: 'personal:run_1', executionGeneration: 4 })
  expect(mocks.start).not.toHaveBeenCalled()
  expect(mocks.getRun).not.toHaveBeenCalled()
})

test('a concurrent losing workflow returns the durable root handle rather than its own Run', async () => {
  mocks.get.mockResolvedValue(snapshot())
  mocks.admit.mockResolvedValue(snapshot({ policy: { publicStreamVersion: 1 } }))
  mocks.start.mockResolvedValue({ runId: 'losing-workflow' })

  await expect(startPersonalHarness({ workflow, agentRun: agentRun(), paid: true, goal: 'Read.' }))
    .resolves.toEqual({ accepted: true, runId: 'personal:run_1', executionGeneration: 0 })
  expect(mocks.getRun).not.toHaveBeenCalled()
})

test('a lost versioned start acknowledgement is retried under the durable claim fence', async () => {
  mocks.get.mockResolvedValue(snapshot())
  mocks.admit.mockResolvedValue(snapshot({ policy: { publicStreamVersion: 1 }, executionGeneration: 2 }))
  mocks.start.mockRejectedValueOnce(new Error('acknowledgement lost')).mockResolvedValueOnce({ runId: 'retry' })

  await expect(startPersonalHarness({ workflow, agentRun: agentRun(), paid: true, goal: 'Read.' }))
    .resolves.toEqual({ accepted: true, runId: 'personal:run_1', executionGeneration: 2 })
  expect(mocks.start).toHaveBeenCalledTimes(2)
  expect(mocks.getRun).not.toHaveBeenCalled()
})

test('a duplicate start acknowledgement resolves to the workflow that claimed the root', async () => {
  mocks.start.mockImplementation(async () => {
    mocks.get.mockResolvedValueOnce(snapshot({ workflowRunId: 'actual-winner' }))
    return { runId: 'duplicate-loser' }
  })

  await startPersonalHarness({ workflow, agentRun: agentRun(), paid: true, goal: 'Read.' })

  expect(mocks.getRun).toHaveBeenCalledWith('actual-winner')
})

test('legacy, terminal, and mismatched replay ownership is rejected without admission or mutation', async () => {
  await expect(startPersonalHarness({
    workflow, agentRun: agentRun({ runner: 'tool_loop' }), paid: true, goal: 'Read.',
  })).rejects.toBeInstanceOf(PersonalHarnessAdmissionConflict)
  await expect(startPersonalHarness({
    workflow, agentRun: agentRun({ executionEngine: undefined }), paid: true, goal: 'Read.',
  })).rejects.toBeInstanceOf(PersonalHarnessAdmissionConflict)
  await expect(startPersonalHarness({
    workflow, agentRun: agentRun({ status: 'completed' }), paid: true, goal: 'Read.',
  })).rejects.toBeInstanceOf(PersonalHarnessAdmissionConflict)
  await expect(startPersonalHarness({
    workflow, agentRun: agentRun({ workflowRunId: 'legacy-workflow' }), paid: true, goal: 'Read.',
  })).rejects.toBeInstanceOf(PersonalHarnessAdmissionConflict)
  expect(mocks.admit).not.toHaveBeenCalled()
  expect(mocks.start).not.toHaveBeenCalled()
})

test('an immutable admission conflict is typed and does not start or fail a run', async () => {
  mocks.admit.mockRejectedValue(new Error('HARNESS_ADMISSION_CONFLICT'))
  await expect(startPersonalHarness({ workflow, agentRun: agentRun(), paid: true, goal: 'Read.' }))
    .rejects.toBeInstanceOf(PersonalHarnessAdmissionConflict)
  expect(mocks.start).not.toHaveBeenCalled()
})

test('an ambiguous workflow start leaves the admitted root intact and reports pending', async () => {
  mocks.start.mockRejectedValue(new Error('start acknowledgement lost'))
  const onAdmitted = vi.fn()

  await expect(startPersonalHarness({
    workflow, agentRun: agentRun(), paid: true, goal: 'Read.', onAdmitted,
  })).rejects.toBeInstanceOf(PersonalHarnessStartPending)

  expect(onAdmitted).toHaveBeenCalledOnce()
  expect(mocks.admit).toHaveBeenCalledOnce()
  expect(mocks.start).toHaveBeenCalledOnce()
  expect(mocks.get).toHaveBeenCalledOnce()
})

test('workflow authentication references contain no credentials', () => {
  const auth = {
    userId: 'user',
    accessToken: 'secret-token',
    authType: 'api-key',
    apiKeyId: 'key-id',
  } as AuthenticatedAppUser

  const reference = personalHarnessAuthentication(auth)
  expect(reference).toEqual({ type: 'api-key', apiKeyId: 'key-id' })
  expect(JSON.stringify(reference)).not.toContain('secret-token')
  expect(() => personalHarnessAuthentication({ ...auth, authType: 'service' })).toThrow()
})
