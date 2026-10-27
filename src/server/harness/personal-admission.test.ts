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
    budget: { maxProviderCostUsd: 0.25, durationMs: 60_000 },
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
      deadlineAt: 1_700_000_060_000,
      maxCostMicros: 250_000,
    }),
  }))
  expect(onAdmitted).toHaveBeenCalledOnce()
  expect(mocks.start).toHaveBeenCalledOnce()
  expect(mocks.getRun).toHaveBeenCalledWith('winning-workflow')
})

test('a claimed duplicate returns the canonical workflow without starting another', async () => {
  mocks.admit.mockResolvedValue(snapshot({ workflowRunId: 'canonical-workflow' }))

  expect(await startPersonalHarness({ workflow, agentRun: agentRun({ harnessRunId: 'personal:run_1' }), paid: true, goal: 'Read.' }))
    .toEqual({ runId: 'canonical-workflow' })
  expect(mocks.start).not.toHaveBeenCalled()
  expect(mocks.getRun).toHaveBeenCalledWith('canonical-workflow')
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
  expect(mocks.get).not.toHaveBeenCalled()
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
