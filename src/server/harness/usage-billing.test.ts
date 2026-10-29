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
import type { UsageRepository } from '@/server/usage'

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

test('internal model receipts preserve usage but do not consume another request allowance', async () => {
  const recordBatch = vi.fn(async () => ({ recorded: 1 }))
  const durable = new BillingBackedActUsagePolicy({ repository: { recordBatch } as unknown as UsageRepository })
  await durable.recordFinishedUsage({ ...usage, reservationId: null, countAsRequest: false, requireRecorded: true,
    workspaceId: 'original-workspace', operationId: 'harness:root:model:1', providerCostUsd: 0 })
  expect(recordBatch).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: 'original-workspace', operationId: 'harness:root:model:1',
    events: [expect.objectContaining({ countAsRequest: false, providerCostUsd: 0, cachedTokens: 600, inputTokens: 1_000 })] }))
  recordBatch.mockRejectedValueOnce(new Error('database unavailable'))
  await expect(durable.recordFinishedUsage({ ...usage, reservationId: null, requireRecorded: true })).rejects.toThrow(/could not be recorded/)
})

test('durable zero-usage calls are recorded, and a frozen catalog quote is not relabeled as exact provider cost', async () => {
  const recordBatch = vi.fn<UsageRepository['recordBatch']>().mockResolvedValue({ recorded: 1 })
  const durable = new BillingBackedActUsagePolicy({ repository: { recordBatch } as unknown as UsageRepository })
  await durable.recordFinishedUsage({ ...usage, reservationId: null, inputTokens: 0, outputTokens: 0,
    cachedInputTokens: 0, cacheWriteTokens: 0, requireRecorded: true, catalogCostUsd: 0, operationId: 'zero' })
  expect(recordBatch).toHaveBeenCalledWith(expect.objectContaining({ events: [expect.objectContaining({ costCents: 0 })] }))
  await durable.recordFinishedUsage({ ...usage, reservationId: null, requireRecorded: true, catalogCostUsd: 0.00082 })
  expect(recordBatch.mock.calls[1][0].events[0]).not.toHaveProperty('providerCostUsd')
  expect(mocks.pricing).not.toHaveBeenCalled()
  await expect(durable.recordFinishedUsage({ ...usage, catalogCostUsd: -1 })).rejects.toThrow(/catalog cost/)
})

test('durable callers cannot advance past an unsettled reservation or unknown pricing', async () => {
  mocks.finalize.mockResolvedValueOnce({ status: 'reconcile_required' })
  await expect(policy.recordFinishedUsage({ ...usage, requireRecorded: true })).rejects.toThrow(/reconciliation/)
  mocks.pricing.mockResolvedValueOnce(null)
  await expect(policy.recordFinishedUsage({ ...usage, requireRecorded: true })).rejects.toThrow(/pricing requires reconciliation/)
  mocks.finalize.mockResolvedValueOnce({ status: 'finalized' })
  expect(await policy.recordFinishedUsage({ ...usage, requireRecorded: true, countAsRequest: false })).toMatchObject({ finalized: true })
  expect(mocks.finalize).toHaveBeenLastCalledWith(expect.objectContaining({ events: [expect.objectContaining({ countAsRequest: false })] }))
})
