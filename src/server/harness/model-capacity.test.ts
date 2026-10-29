import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { createHarnessSnapshot } from '@overlay/agent-runtime/harness-state'
import { createHarnessCapacityWaiter } from './model-capacity'

const mocks = vi.hoisted(() => ({ sleep: vi.fn() }))
vi.mock('workflow', () => ({ sleep: mocks.sleep }))

const snapshot = () => ({ ...createHarnessSnapshot({ runId: 'run', goal: 'Respond', constraints: [], policy: {
  actorUserId: 'user', allowedToolIds: [], requiresPlan: false, maxCostMicros: 0,
  maxDepth: 1, maxParallelChildren: 2, deadlineAt: Date.now() + 600_000,
} }, Date.now()), status: 'running' as const, latestReceipt: {
  id: 'model:0', modelId: 'openrouter/free', provider: 'overlay-free-router', inputTokens: 0, outputTokens: 0,
  reasoningTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, costMicros: 0, contextWindow: null,
  costSource: 'catalog' as const, rejectionReason: 'route_capacity' as const,
} })

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(1_000); mocks.sleep.mockReset().mockResolvedValue(undefined) })
afterEach(() => vi.useRealTimers())

test('capacity waits are durable and bounded across fresh receipt IDs until a successful call resets them', async () => {
  const capacity = createHarnessCapacityWaiter()
  const state = snapshot()
  expect(await capacity.wait(state, 'model:0', 'openrouter/free')).toBe(true)
  expect(mocks.sleep).toHaveBeenCalledExactlyOnceWith(new Date(6_000))
  vi.setSystemTime(301_000)
  state.latestReceipt.id = 'model:1'
  expect(await capacity.wait(state, 'model:1', 'openrouter/free')).toBe(false)
  capacity.reset()
  expect(await capacity.wait(state, 'model:1', 'openrouter/free')).toBe(true)
})

test('capacity waits respect the run deadline and never release an unresolved hold', async () => {
  const state = snapshot()
  state.policy.deadlineAt = 1_010
  const capacity = createHarnessCapacityWaiter()
  expect(await capacity.wait(state, 'model:0', 'openrouter/free')).toBe(true)
  expect(mocks.sleep).toHaveBeenCalledWith(new Date(1_010))
  vi.setSystemTime(1_010)
  expect(await capacity.wait(state, 'model:0', 'openrouter/free')).toBe(false)
  const unresolved = { ...snapshot(), modelReservation: { id: 'model:0', maxCostMicros: 0 } }
  expect(await createHarnessCapacityWaiter().wait(unresolved, 'model:0', 'openrouter/free')).toBe(false)
  expect(unresolved.modelReservation).toEqual({ id: 'model:0', maxCostMicros: 0 })
  expect(mocks.sleep).toHaveBeenCalledOnce()
})

test('stale, paid, terminal and non-capacity receipts never authorize another dispatch', async () => {
  const state = snapshot()
  const capacity = createHarnessCapacityWaiter()
  expect(await capacity.wait(state, 'other', 'openrouter/free')).toBe(false)
  expect(await capacity.wait({ ...state, status: 'cancelled' }, 'model:0', 'openrouter/free')).toBe(false)
  expect(await capacity.wait({ ...state, latestReceipt: { ...state.latestReceipt, rejectionReason: 'model_unavailable' } }, 'model:0', 'openrouter/free')).toBe(false)
  expect(await capacity.wait({ ...state, latestReceipt: { ...state.latestReceipt, modelId: 'paid/model' } }, 'model:0', 'paid/model')).toBe(false)
  expect(mocks.sleep).not.toHaveBeenCalled()
})
