import { beforeEach, expect, test, vi } from 'vitest'
import { automationRunWorkflow } from '@/server/workflows/automation-run'

const mocks = vi.hoisted(() => ({
  dispose: vi.fn(), run: vi.fn(), settleDenied: vi.fn(),
}))

vi.mock('workflow', () => ({
  FatalError: class FatalError extends Error {},
  createHook: () => Object.assign(Promise.resolve({ approved: false }), { dispose: mocks.dispose }),
  getWorkflowMetadata: () => ({ workflowRunId: 'workflow' }),
  sleep: vi.fn(),
}))
vi.mock('@/server/workflows/automation-harness-steps', () => ({
  settleDeniedAutomationRun: mocks.settleDenied,
}))
vi.mock('@/server/workflows/automation-agent-turn', () => ({
  runAutomationAgentTurn: mocks.run,
}))

const input = {
  automationId: 'automation',
  userId: 'user',
  name: 'Fixture',
  description: '',
  instructions: 'Do the task.',
  approvalToken: 'approval-token',
  runId: 'run',
  scheduledFor: 1,
}

beforeEach(() => {
  vi.resetAllMocks()
  mocks.settleDenied.mockResolvedValue(true)
})

test('denied approval owner-fenced settles and never admits native execution', async () => {
  await expect(automationRunWorkflow(input)).resolves.toMatchObject({
    automationId: 'automation',
    runId: 'run',
    completed: false,
    skipped: true,
  })
  expect(mocks.settleDenied).toHaveBeenCalledWith(expect.objectContaining({
    automationId: 'automation',
    runId: 'run',
    userId: 'user',
    workflowRunId: 'workflow',
    reason: expect.stringContaining('denied or timed out'),
  }))
  expect(mocks.run).not.toHaveBeenCalled()
  expect(mocks.dispose).toHaveBeenCalledOnce()
})

test('denied approval fails closed when owner settlement loses its fence', async () => {
  mocks.settleDenied.mockResolvedValue(false)
  await expect(automationRunWorkflow(input)).rejects.toThrow(/could not be settled by its owner/)
  expect(mocks.run).not.toHaveBeenCalled()
})

test('approved runs execute with the turn ID derived from the run', async () => {
  vi.mocked(mocks.run).mockResolvedValue({ conversationId: 'conversation', replyText: 'done', status: 'completed' })
  const { approvalToken: _approvalToken, ...unapproved } = input
  await expect(automationRunWorkflow(unapproved)).resolves.toMatchObject({ completed: true, status: 'completed' })
  expect(mocks.run).toHaveBeenCalledWith(expect.objectContaining({
    automationId: 'automation', runId: 'run', turnId: 'automation-run:run', scheduledFor: 1,
  }))
  expect(mocks.settleDenied).not.toHaveBeenCalled()
})
