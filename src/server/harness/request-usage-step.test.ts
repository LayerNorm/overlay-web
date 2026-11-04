import { beforeEach, expect, test, vi } from 'vitest'
import { createHarnessSnapshot } from '@overlay/agent-runtime/harness-state'
import { admitHarnessRequestUsage } from './request-usage-step'

const mocks = vi.hoisted(() => ({ read: vi.fn(), record: vi.fn() }))
vi.mock('server-only', () => ({}))
vi.mock('./ConvexHarnessRepository', () => ({ ConvexHarnessRepository: class { get = mocks.read } }))
vi.mock('@/server/bootstrap', () => ({ getOverlayServerContext: () => ({ appData: { repositories: { usage: { recordBatch: mocks.record } } } }) }))

const reference = { actorUserId: 'user', runId: 'root', workflowRunId: 'workflow' }
const snapshot = () => ({ ...createHarnessSnapshot({ runId: 'root', goal: 'Complete the work', constraints: [], policy: {
  actorUserId: 'user', workspaceId: 'original-workspace', requiresPlan: false, allowedToolIds: [],
  maxCostMicros: 0, deadlineAt: 10_000, maxDepth: 1, maxParallelChildren: 2,
} }, 1), workflowRunId: 'workflow' })

beforeEach(() => { vi.resetAllMocks(); mocks.read.mockResolvedValue(snapshot()) })

test('admission uses the root identity and original workspace for an idempotent quota write', async () => {
  await admitHarnessRequestUsage(reference, 'provider/free-model')
  expect(mocks.read).toHaveBeenCalledWith({ actorUserId: 'user', runId: 'root' })
  expect(mocks.record).toHaveBeenCalledWith({ userId: 'user', workspaceId: 'original-workspace', operationId: 'harness:root:request',
    events: [{ kind: 'agent', modelId: 'provider/free-model', countAsRequest: true, costCents: 0, occurredAt: 1 }] })
  mocks.record.mockRejectedValueOnce(new Error('free tier limit'))
  await expect(admitHarnessRequestUsage(reference, 'provider/free-model')).rejects.toThrow(/limit/)
})

test('child and BYOK calls do not consume new request allowances, and execution ownership is mandatory', async () => {
  await admitHarnessRequestUsage(reference, 'byok/connection/model')
  mocks.read.mockResolvedValueOnce({ ...snapshot(), parentRunId: 'parent' })
  await admitHarnessRequestUsage(reference, 'provider/free-model')
  expect(mocks.record).not.toHaveBeenCalled()
  for (const value of [null, { ...snapshot(), workflowRunId: 'other' }, { ...snapshot(), status: 'cancelled' },
    { ...snapshot(), status: 'completed' }, { ...snapshot(), status: 'failed' },
    { ...snapshot(), status: 'waiting_for_authorization' }, { ...snapshot(), executionGeneration: 1 }]) {
    mocks.read.mockResolvedValueOnce(value)
    await expect(admitHarnessRequestUsage(reference, 'provider/free-model')).rejects.toThrow('HARNESS_EXECUTION_NOT_OWNED')
  }
  expect(mocks.record).not.toHaveBeenCalled()
})

test.each(['waiting_for_children', 'waiting_for_input', 'waiting_for_approval', 'waiting_for_resources'] as const)(
  'an owned continuation can re-admit while %s without requiring the wait to have resolved', async status => {
    const state = { ...snapshot(), status, executionGeneration: 2 }
    mocks.read.mockResolvedValue(state)
    await admitHarnessRequestUsage({ ...reference, executionGeneration: 2 }, 'provider/free-model')
    expect(mocks.record).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ operationId: 'harness:root:request' }))
    expect(state.status).toBe(status)
  },
)
