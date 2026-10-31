import { beforeEach, expect, test, vi } from 'vitest'
import { FatalError } from 'workflow'
import { runAutomationAgentTurn } from '@/server/workflows/automation-agent-turn'
import * as automationWorkflow from '@/server/workflows/automation-agent-turn'

const mocks = vi.hoisted(() => ({
  ready: vi.fn(), getAppSettings: vi.fn(), assertSource: vi.fn(), ensureConversation: vi.fn(),
  markRunStarted: vi.fn(), prepare: vi.fn(), startAgentRun: vi.fn(), admit: vi.fn(),
  harnessWorkflow: vi.fn(), getRun: vi.fn(), settleRun: vi.fn(), getLatestAgentRun: vi.fn(),
  getMessages: vi.fn(), readHarness: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('workflow', () => ({
  FatalError: class FatalError extends Error {},
  RetryableError: class RetryableError extends Error {},
  getWorkflowMetadata: () => ({ workflowRunId: 'workflow' }),
}))
vi.mock('@/server/bootstrap', () => ({
  getOverlayServerContext: () => ({
    appData: {
      repositories: {
        conversations: { getAppSettings: mocks.getAppSettings, getLatestAgentRun: mocks.getLatestAgentRun,
          getConversationMessages: mocks.getMessages },
        automations: { getRunForExecution: mocks.getRun },
      },
    },
  }),
}))
vi.mock('@/server/harness/backend-readiness', () => ({ isHarnessBackendReady: mocks.ready }))
vi.mock('@/server/harness/automation-access', () => ({ assertAutomationAdmissionSource: mocks.assertSource }))
vi.mock('@/server/automations/http', () => ({
  automationService: { markRunStarted: mocks.markRunStarted, settleRun: mocks.settleRun },
}))
vi.mock('@/server/conversations/http', () => ({
  agentRunService: { startPersonalWorkflow: mocks.startAgentRun },
}))
vi.mock('@/server/automations/automation-turn-runner', () => ({
  AutomationTurnError: class AutomationTurnError extends Error { statusCode = 400 },
  ensureAutomationConversation: mocks.ensureConversation,
  prepareAutomationAgentTurn: mocks.prepare,
}))
vi.mock('@/server/harness/ConvexHarnessRepository', () => ({
  ConvexHarnessRepository: class { admit = mocks.admit; get = mocks.readHarness },
}))
vi.mock('@/server/harness/personal-admission-policy', () => ({ personalHarnessPolicy: vi.fn(() => ({})) }))
vi.mock('@/server/harness/write-tools', () => ({ harnessToolsRequirePlan: vi.fn(() => true) }))
vi.mock('@/server/workflows/personal-harness', () => ({ personalHarnessWorkflow: mocks.harnessWorkflow }))

const source = {
  workspaceId: 'workspace',
  principalId: 'principal',
  conversationId: 'conversation',
  turnId: 'automation-run:run',
  automationRunId: 'run',
}
const plan = {
  conversationId: 'conversation',
  workspaceId: 'workspace',
  effectiveModelId: 'fixture/model',
  userMessageId: 'message',
  paid: true,
  toolDefinitions: [{ name: 'read_file' }],
  instructions: 'Read the requested data.',
  messages: [{ role: 'user', content: 'Read the requested data.' }],
  toolingContext: { userId: 'user', workspaceId: 'workspace', conversationId: 'conversation' },
  sourceCitations: [],
}
const input = {
  automationId: 'automation',
  runId: 'run',
  userId: 'user',
  name: 'Fixture',
  description: '',
  instructions: 'Read the requested data.',
  modelId: 'fixture/model',
  turnId: 'caller-controlled',
  workspaceId: 'workspace',
}

beforeEach(() => {
  vi.resetAllMocks()
  mocks.ready.mockReturnValue(true)
  mocks.getAppSettings.mockResolvedValue({ harnessRevision: 'overlay-harness-v1' })
  mocks.assertSource.mockResolvedValue(source)
  mocks.ensureConversation.mockResolvedValue({ conversationId: 'conversation', workspaceId: 'workspace' })
  mocks.markRunStarted.mockResolvedValue(undefined)
  mocks.prepare.mockResolvedValue(plan)
  mocks.startAgentRun.mockResolvedValue({ id: 'delivery', createdAt: 1 })
  mocks.admit.mockResolvedValue({ runId: 'personal:delivery', status: 'queued' })
  mocks.harnessWorkflow.mockResolvedValue({ runId: 'personal:delivery', status: 'completed', replyText: 'persisted reply' })
  mocks.getRun.mockResolvedValue({ run: { _id: 'run', automationId: 'automation', userId: 'user',
    status: 'running', workflowRunId: 'workflow', turnId: 'automation-run:run' } })
  mocks.settleRun.mockResolvedValue(true)
  mocks.getLatestAgentRun.mockResolvedValue({ id: 'delivery', userId: 'user', turnId: 'automation-run:run' })
  mocks.getMessages.mockResolvedValue([{ role: 'assistant', turnId: 'automation-run:run', content: 'persisted reply' }])
})

test('readiness fails before conversation, user-message, AgentRun, or Harness admission', async () => {
  mocks.ready.mockReturnValue(false)
  await expect(runAutomationAgentTurn(input)).rejects.toBeInstanceOf(FatalError)
  expect(mocks.assertSource).not.toHaveBeenCalled()
  expect(mocks.ensureConversation).not.toHaveBeenCalled()
  expect(mocks.markRunStarted).not.toHaveBeenCalled()
  expect(mocks.prepare).not.toHaveBeenCalled()
  expect(mocks.startAgentRun).not.toHaveBeenCalled()
  expect(mocks.admit).not.toHaveBeenCalled()
  expect(mocks.harnessWorkflow).not.toHaveBeenCalled()
})

test('source denial fails before conversation, message, AgentRun, or Harness side effects', async () => {
  mocks.assertSource.mockRejectedValueOnce(new FatalError('Automation workspace binding changed.'))
  await expect(runAutomationAgentTurn(input)).rejects.toThrow(/workspace binding changed/)
  expect(mocks.ensureConversation).not.toHaveBeenCalled()
  expect(mocks.markRunStarted).not.toHaveBeenCalled()
  expect(mocks.prepare).not.toHaveBeenCalled()
  expect(mocks.startAgentRun).not.toHaveBeenCalled()
  expect(mocks.admit).not.toHaveBeenCalled()
  expect(mocks.harnessWorkflow).not.toHaveBeenCalled()
})

test('queued manual ACK starts before native Harness and never invokes the legacy runner', async () => {
  const result = await runAutomationAgentTurn(input)
  expect(result).toMatchObject({ status: 'completed', replyText: 'persisted reply' })
  expect(mocks.markRunStarted).toHaveBeenCalledWith(expect.objectContaining({
    runId: 'run',
    expectedWorkflowRunId: 'workflow',
    conversationId: 'conversation',
    turnId: 'automation-run:run',
  }))
  expect(mocks.startAgentRun).toHaveBeenCalledWith(expect.objectContaining({
    conversationId: 'conversation',
    userMessageId: 'message',
    turnId: 'automation-run:run',
  }))
  expect(mocks.admit).toHaveBeenCalledWith(expect.objectContaining({
    runId: 'personal:delivery',
    deliveryAgentRunId: 'delivery',
  }))
  expect(mocks.harnessWorkflow).toHaveBeenCalledWith(expect.objectContaining({
    access: expect.objectContaining({
      authentication: expect.objectContaining({
        type: 'automation', automationId: 'automation', automationRunId: 'run',
        originWorkflowRunId: 'workflow',
      }),
    }),
  }))
  expect(mocks.markRunStarted.mock.invocationCallOrder[0]).toBeLessThan(mocks.prepare.mock.invocationCallOrder[0])
  expect(mocks.admit.mock.invocationCallOrder[0]).toBeLessThan(mocks.harnessWorkflow.mock.invocationCallOrder[0])
})

test('legacy capped surface loop is no longer exported or callable', () => {
  expect('runDurableAgentTurn' in automationWorkflow).toBe(false)
})

test('surface inputs are rejected without choosing an automation fallback', async () => {
  await expect(runAutomationAgentTurn({ ...input, surface: {} as never })).rejects.toThrow(/surface workflow/)
  expect(mocks.ready).not.toHaveBeenCalled()
  expect(mocks.ensureConversation).not.toHaveBeenCalled()
  expect(mocks.prepare).not.toHaveBeenCalled()
  expect(mocks.harnessWorkflow).not.toHaveBeenCalled()
})

test('a foreign duplicate admission is returned without entering or settling the other worker', async () => {
  mocks.admit.mockResolvedValue({ runId: 'personal:delivery', workflowRunId: 'other-workflow', status: 'running' })
  const result = await runAutomationAgentTurn(input)
  expect(result).toMatchObject({ status: 'already_running', replyText: '' })
  expect(mocks.harnessWorkflow).not.toHaveBeenCalled()
  expect(mocks.settleRun).not.toHaveBeenCalled()
})

test('same-owner completed replay reads persisted delivery and reconciles the automation run', async () => {
  mocks.admit.mockResolvedValue({
    runId: 'personal:delivery', workflowRunId: 'workflow', status: 'completed',
  })
  const result = await runAutomationAgentTurn(input)
  expect(result).toMatchObject({ status: 'completed', replyText: 'persisted reply' })
  expect(mocks.assertSource.mock.calls[0]?.[0]).toMatchObject({
    runId: 'run', turnId: 'automation-run:run', originWorkflowRunId: 'workflow',
  })
  expect(mocks.markRunStarted).toHaveBeenCalledWith(expect.objectContaining({
    turnId: 'automation-run:run',
    expectedWorkflowRunId: 'workflow',
  }))
  expect(mocks.harnessWorkflow).not.toHaveBeenCalled()
  expect(mocks.settleRun).toHaveBeenCalledWith(expect.objectContaining({
    runId: 'run', expectedWorkflowRunId: 'workflow', expectedStatus: 'running',
    expectedTurnId: 'automation-run:run', status: 'completed',
  }))
})

test.each([
  ['failed', 'Provider request timed out.'],
  ['cancelled', 'Run stopped by its owner.'],
] as const)('same-owner %s terminal replay settles its persisted reason', async (status, terminalReason) => {
  mocks.harnessWorkflow.mockRejectedValueOnce(new Error('workflow replayed a terminal failure'))
  mocks.readHarness.mockResolvedValueOnce({
    runId: 'personal:delivery', workflowRunId: 'workflow', status, terminalReason,
  })
  const result = await runAutomationAgentTurn(input)
  expect(result).toMatchObject({ status, replyText: '' })
  expect(mocks.settleRun).toHaveBeenCalledWith(expect.objectContaining({
    runId: 'run', expectedWorkflowRunId: 'workflow', expectedStatus: 'running',
    expectedTurnId: 'automation-run:run', status, error: terminalReason,
  }))
})
