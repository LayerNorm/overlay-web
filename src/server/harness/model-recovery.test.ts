import { beforeEach, expect, test, vi } from 'vitest'
import {
  createHarnessSnapshot,
  recordHarnessReceipt,
  validateHarnessReceipt,
  type HarnessReceipt,
  type HarnessSnapshot,
} from '@overlay/agent-runtime/harness-state'
import { waitForHarnessModelRecovery } from './model-recovery'
import { terminateOnProviderFailure } from './model-recovery'
import type { HarnessExecutionPorts } from './ports'

const mocks = vi.hoisted(() => ({ read: vi.fn(), sleep: vi.fn() }))
vi.mock('./state-steps', () => ({ readHarnessState: mocks.read }))
vi.mock('workflow', () => ({ sleep: mocks.sleep }))
const reference = { actorUserId: 'user', runId: 'run', workflowRunId: 'workflow' }
const initial = (): HarnessSnapshot => ({ ...createHarnessSnapshot({ runId: 'run', goal: 'Complete the work', constraints: [],
  policy: { actorUserId: 'user', allowedToolIds: [], requiresPlan: false, maxCostMicros: 100,
    maxDepth: 0, maxParallelChildren: 0, deadlineAt: 10_000_000 } }, 0), workflowRunId: 'workflow' })
const receipt = (id: string): HarnessReceipt => ({ id, modelId: 'provider/model', provider: 'provider', inputTokens: 10,
  outputTokens: 0, reasoningTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, contextWindow: null,
  costMicros: 1, costSource: 'catalog', responseFailure: 'empty_response' })

beforeEach(() => { vi.resetAllMocks(); mocks.sleep.mockResolvedValue(undefined) })

test('rejects receipts that combine response failure and rejection', () => {
  expect(() => validateHarnessReceipt({ ...receipt('model:0'), rejectionReason: 'model_unavailable' }))
    .toThrow(/Invalid settled model response failure/)
})

test.each(['error', 'content-filter'] as const)('provider finish reason %s persists a safe structured failure', async finishReason => {
  const state = initial()
  const apply = vi.fn(async () => state)
  expect(await terminateOnProviderFailure(state, finishReason, { apply } as unknown as HarnessExecutionPorts, 3)).toBe(true)
  expect(apply).toHaveBeenCalledWith('provider-failure:3', expect.objectContaining({
    type: 'terminate',
    status: 'failed',
    reason: expect.stringContaining('Diagnostic ID:'),
    diagnostic: expect.objectContaining({
      code: finishReason === 'content-filter' ? 'PROVIDER_REJECTED' : 'PROVIDER_UNAVAILABLE',
      stage: 'model',
      retryability: 'user_action',
    }),
  }))
})

test('settled failures persist exponential backoff without advancing progress, then reset on a usable response', () => {
  let state = initial()
  for (const [index, delay] of [5_000, 10_000, 20_000, 40_000, 80_000, 160_000, 300_000, 300_000].entries()) {
    const priorProgress = state.progressRevision
    state = recordHarnessReceipt(state, receipt(`model:${index}`), 1_000)
    expect(state.modelRecovery).toEqual({ receiptId: `model:${index}`, modelId: 'provider/model', code: 'empty_response',
      attempt: index + 1, firstFailureAt: 1_000, nextRetryAt: 1_000 + delay })
    expect(state.progressRevision).toBe(priorProgress)
    expect(recordHarnessReceipt(state, receipt(`model:${index}`), 2_000)).toBe(state)
  }
  expect(state.usage.costMicros).toBe(8)
  const summary = { ...receipt('summary:model:8:0'), responseFailure: undefined }
  state = recordHarnessReceipt(state, summary, 2_000)
  expect(state.modelRecovery?.attempt).toBe(8)
  state = recordHarnessReceipt(state, { ...receipt('model:8'), responseFailure: undefined }, 3_000)
  expect(state.modelRecovery).toBeUndefined()
})

test('summary recovery has independent durable attempts without resetting response recovery or advancing progress', () => {
  let state = recordHarnessReceipt(initial(), receipt('model:0'), 1_000)
  const responseRecovery = state.modelRecovery
  const progress = state.progressRevision
  for (const [attempt, nextRetryAt] of [[1, 7_000], [2, 12_000]]) {
    state = recordHarnessReceipt(state, receipt(`summary:model:1:${attempt}`), 2_000)
    state = JSON.parse(JSON.stringify(state)) as HarnessSnapshot
    expect(state.summaryRecovery).toMatchObject({ attempt, nextRetryAt, firstFailureAt: 2_000, code: 'empty_response' })
    expect(state.modelRecovery).toEqual(responseRecovery)
    expect(state.progressRevision).toBe(progress)
  }
  state = recordHarnessReceipt(state, { ...receipt('summary:model:1:usable'), responseFailure: undefined }, 3_000)
  expect(state.summaryRecovery).toBeUndefined()
  expect(state.modelRecovery).toEqual(responseRecovery)
  expect(state.usage.costMicros).toBe(4)
})

test.each(['model:0', 'summary:model:0:0'])('durable retry %s uses the stored time and rechecks ownership and cancellation after waking', async id => {
  const state = recordHarnessReceipt(initial(), receipt(id), 1_000)
  mocks.read.mockResolvedValue(state)
  expect(await waitForHarnessModelRecovery(reference, id)).toBe(true)
  expect(mocks.sleep).toHaveBeenCalledExactlyOnceWith(new Date(6_000))
  mocks.read.mockResolvedValueOnce(state).mockResolvedValueOnce({ ...state, status: 'cancelled' })
  expect(await waitForHarnessModelRecovery(reference, id)).toBe(false)
  mocks.read.mockResolvedValueOnce(state).mockResolvedValueOnce({ ...state, workflowRunId: 'other' })
  expect(await waitForHarnessModelRecovery(reference, id)).toBe(false)
})

test.each(['model:0', 'summary:model:0:0'])('unsettled usage, stale receipts and foreign owners cannot authorize retry %s or release a hold', async id => {
  const state = recordHarnessReceipt(initial(), receipt(id), 1_000)
  for (const candidate of [
    { ...state, modelReservation: { id, maxCostMicros: 50 } },
    { ...state, workflowRunId: 'other' },
    { ...state, latestReceipt: receipt('other') },
    { ...state, status: 'failed' as const },
  ]) {
    mocks.read.mockResolvedValue(candidate)
    expect(await waitForHarnessModelRecovery(reference, id)).toBe(false)
  }
  expect(mocks.sleep).not.toHaveBeenCalled()
})
