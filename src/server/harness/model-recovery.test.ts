import { beforeEach, expect, test, vi } from 'vitest'
import {
  createHarnessSnapshot,
  recordHarnessReceipt,
  validateHarnessReceipt,
  type HarnessReceipt,
  type HarnessSnapshot,
} from '@overlay/agent-runtime/harness-state'
import { waitForHarnessModelRecovery } from './model-recovery'

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

test('free interruptions and capacity rejections share bounded backoff and respect authorization expiry', () => {
  let state = initial()
  state.policy.deadlineAt = 12_000
  for (const [index, rejectionReason] of (['route_interrupted', 'route_capacity', 'route_interrupted'] as const).entries()) {
    state = recordHarnessReceipt(state, { ...receipt(`model:${index}`), modelId: 'openrouter/free',
      provider: 'overlay-free-router', responseFailure: undefined, inputTokens: 0, costMicros: 0, rejectionReason }, 1_000)
  }
  expect(state.modelRecovery).toMatchObject({ attempt: 3, nextRetryAt: 12_000, code: 'route_interrupted' })
  expect(state.usage.costMicros).toBe(0)
})

test('durable retry uses the stored time and rechecks ownership and cancellation after waking', async () => {
  const state = recordHarnessReceipt(initial(), receipt('model:0'), 1_000)
  mocks.read.mockResolvedValue(state)
  expect(await waitForHarnessModelRecovery(reference, 'model:0')).toBe(true)
  expect(mocks.sleep).toHaveBeenCalledExactlyOnceWith(new Date(6_000))
  mocks.read.mockResolvedValueOnce(state).mockResolvedValueOnce({ ...state, status: 'cancelled' })
  expect(await waitForHarnessModelRecovery(reference, 'model:0')).toBe(false)
  mocks.read.mockResolvedValueOnce(state).mockResolvedValueOnce({ ...state, workflowRunId: 'other' })
  expect(await waitForHarnessModelRecovery(reference, 'model:0')).toBe(false)
})

test('unsettled usage, stale receipts and foreign owners cannot authorize a retry or release a hold', async () => {
  const state = recordHarnessReceipt(initial(), receipt('model:0'), 1_000)
  for (const candidate of [
    { ...state, modelReservation: { id: 'model:0', maxCostMicros: 50 } },
    { ...state, workflowRunId: 'other' },
    { ...state, latestReceipt: receipt('other') },
    { ...state, status: 'failed' as const },
  ]) {
    mocks.read.mockResolvedValue(candidate)
    expect(await waitForHarnessModelRecovery(reference, 'model:0')).toBe(false)
  }
  expect(mocks.sleep).not.toHaveBeenCalled()
})
