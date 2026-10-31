import { beforeEach, expect, test, vi } from 'vitest'
import { automationScheduleWorkflow } from '@/server/workflows/automation-schedule'

const mocks = vi.hoisted(() => ({
  dispose: vi.fn(), run: vi.fn(), settleDenied: vi.fn(),
}))

vi.mock('workflow', () => ({
  FatalError: class FatalError extends Error {},
  createHook: () => Object.assign(Promise.resolve({ approved: false }), { dispose: mocks.dispose }),
  getWorkflowMetadata: () => ({ workflowRunId: 'workflow' }),
  sleep: vi.fn(),
}))
vi.mock('@/server/workflows/automation-agent-turn', () => ({
  checkAutomationEnabled: vi.fn(),
  runAutomationAgentTurn: mocks.run,
  settleDeniedAutomationRun: mocks.settleDenied,
}))

const input = {
  automationId: 'automation',
  userId: 'user',
  name: 'Fixture',
  description: '',
  instructions: 'Do the task.',
  schedule: { kind: 'interval' as const, intervalMinutes: 15 },
  oneShot: true,
  approvalRequired: true,
  approvalToken: 'approval-token',
  baseUrl: 'https://example.test',
  runId: 'run',
}

beforeEach(() => {
  vi.resetAllMocks()
  mocks.settleDenied.mockResolvedValue(true)
})

test('denied one-shot approval owner-fenced settles and never admits native execution', async () => {
  await expect(automationScheduleWorkflow(input)).resolves.toMatchObject({
    automationId: 'automation',
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

test('denied one-shot approval fails closed when owner settlement loses its fence', async () => {
  mocks.settleDenied.mockResolvedValue(false)
  await expect(automationScheduleWorkflow(input)).rejects.toThrow(/could not be settled by its owner/)
  expect(mocks.run).not.toHaveBeenCalled()
})
