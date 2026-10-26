import { beforeEach, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ pricing: vi.fn(), finalize: vi.fn(), reconcile: vi.fn() }))
vi.mock('server-only', () => ({}))
vi.mock('@/server/observability/logger', () => ({ logger: { error: vi.fn() } }))
vi.mock('@/server/ai/gateway/live-model-pricing', () => ({ calculateLanguageModelTokenCostOrNull: mocks.pricing }))
vi.mock('@/server/ai/pricing', () => ({ isPremiumModel: () => true }))
vi.mock('@/server/billing/billing-runtime', () => ({
  billableBudgetCentsFromProviderUsd: (dollars: number) => dollars * 100,
  finalizeProviderBudgetReservation: mocks.finalize,
  markProviderBudgetReconcile: mocks.reconcile,
  getPayerEntitlements: vi.fn(), markProviderBudgetStarted: vi.fn(), releaseProviderBudgetReservation: vi.fn(), reserveProviderBudget: vi.fn(),
}))

import { BillingBackedActUsagePolicy, type ActFinishedUsage } from '@/server/conversations/ActUsagePolicy'

const usage: ActFinishedUsage = {
  userId: 'user', modelId: 'provider/model', inputTokens: 1_000, outputTokens: 100,
  cachedInputTokens: 600, cacheWriteTokens: 200, reservationId: 'reservation', forceFreeTierLimits: false,
}
const policy = new BillingBackedActUsagePolicy({
  repository: { getEntitlements: async () => null, recordUsageBatch: async () => undefined },
})

beforeEach(() => { vi.clearAllMocks(); mocks.pricing.mockResolvedValue(0.00071) })

test('harness usage carries cache reads and writes into pricing and the billing event', async () => {
  await policy.recordFinishedUsage(usage)
  expect(mocks.pricing).toHaveBeenCalledWith('provider/model', 1_000, 600, 100, 200)
  expect(mocks.finalize).toHaveBeenCalledWith(expect.objectContaining({
    actualProviderCostUsd: 0.00071,
    events: [expect.objectContaining({ cachedTokens: 600, inputTokens: 1_000, outputTokens: 100 })],
  }))
})

test('an exact provider receipt including zero takes precedence over an estimate', async () => {
  for (const providerCostUsd of [0.00083, 0]) {
    await policy.recordFinishedUsage({ ...usage, providerCostUsd })
    expect(mocks.finalize).toHaveBeenLastCalledWith(expect.objectContaining({ actualProviderCostUsd: providerCostUsd }))
  }
  expect(mocks.pricing).not.toHaveBeenCalled()
})

test('unknown prices reconcile instead of manufacturing a free receipt', async () => {
  mocks.pricing.mockResolvedValue(null)
  await policy.recordFinishedUsage(usage)
  expect(mocks.finalize).not.toHaveBeenCalled()
  expect(mocks.reconcile).toHaveBeenCalledWith(expect.objectContaining({ reservationId: 'reservation' }))
})

test('invalid provider cost and overlapping cache usage are rejected before billing', async () => {
  for (const providerCostUsd of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
    await expect(policy.recordFinishedUsage({ ...usage, providerCostUsd })).rejects.toThrow('Invalid provider cost')
  }
  await expect(policy.recordFinishedUsage({ ...usage, cachedInputTokens: 900 })).rejects.toThrow('Invalid cached token')
  expect(mocks.finalize).not.toHaveBeenCalled()
  expect(mocks.pricing).not.toHaveBeenCalled()
})
