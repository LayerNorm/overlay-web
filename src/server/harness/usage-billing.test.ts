import { beforeEach, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ pricing: vi.fn(), budget: vi.fn() }))
vi.mock('server-only', () => ({}))
vi.mock('@/server/observability/logger', () => ({ logger: { error: vi.fn() } }))
vi.mock('@/server/ai/gateway/live-model-pricing', () => ({ calculateLanguageModelTokenCostOrNull: mocks.pricing }))
vi.mock('@/server/ai/pricing', () => ({ isPremiumModel: () => true }))
vi.mock('@/server/billing/billing-runtime', () => ({
  billableBudgetCentsFromProviderUsd: (dollars: number) => dollars * 100,
  ensureProviderBudgetNotLow: mocks.budget,
  getPayerEntitlements: vi.fn(),
}))

import { BillingBackedActUsagePolicy, type ActFinishedUsage } from '@/server/conversations/ActUsagePolicy'
import type { UsageRepository } from '@/server/usage'

const usage: ActFinishedUsage = {
  userId: 'user', modelId: 'provider/model', inputTokens: 1_000, outputTokens: 100,
  cachedInputTokens: 600, cacheWriteTokens: 200, workspaceId: 'workspace',
}

function durablePolicy(budgetLow = false) {
  const recordBatch = vi.fn<UsageRepository['recordBatch']>().mockResolvedValue({ recorded: 1, budgetLow })
  return { recordBatch, policy: new BillingBackedActUsagePolicy({ repository: { recordBatch } as unknown as UsageRepository }) }
}

beforeEach(() => { vi.clearAllMocks(); mocks.pricing.mockResolvedValue(0.00071) })

test('the budget check is the 2% gate, never a cost estimate', async () => {
  const { policy } = durablePolicy()
  const args = { entitlements: {} as never, userId: 'user', workspaceId: 'workspace', modelId: 'provider/model', operationId: 'op' }
  mocks.budget.mockResolvedValueOnce({ ok: true, entitlements: {} })
  expect(await policy.ensureBudgetNotLow(args)).toEqual({ ok: true })
  expect(mocks.budget).toHaveBeenLastCalledWith({ ...args, kind: 'agent' })
  mocks.budget.mockResolvedValueOnce({ ok: false, status: 402, code: 'insufficient_budget', payload: { message: 'low' } })
  expect(await policy.ensureBudgetNotLow(args)).toEqual({
    ok: false, failure: { statusCode: 402, payload: { message: 'low', error: 'insufficient_budget' } },
  })
  expect(mocks.pricing).not.toHaveBeenCalled()
})

test('finished usage is charged directly, with cache reads and writes priced, and reports budgetLow', async () => {
  const { policy, recordBatch } = durablePolicy(true)
  expect(await policy.recordFinishedUsage({ ...usage, operationId: 'op-1', programmaticSubjectId: 'agent:a' }))
    .toEqual({ recorded: true, budgetLow: true })
  expect(mocks.pricing).toHaveBeenCalledWith('provider/model', 1_000, 600, 100, 200)
  expect(recordBatch).toHaveBeenCalledWith(expect.objectContaining({
    operationId: 'op-1', workspaceId: 'workspace', programmaticSubjectId: 'agent:a',
    events: [expect.objectContaining({ costCents: expect.closeTo(0.071, 9), cachedTokens: 600, inputTokens: 1_000, outputTokens: 100 })],
  }))
})

test('an exact provider receipt including zero takes precedence over catalog pricing', async () => {
  const { policy, recordBatch } = durablePolicy()
  for (const providerCostUsd of [0.00083, 0]) {
    await policy.recordFinishedUsage({ ...usage, providerCostUsd })
    expect(recordBatch).toHaveBeenLastCalledWith(expect.objectContaining({
      events: [expect.objectContaining({ providerCostUsd, costCents: providerCostUsd * 100 })],
    }))
  }
  expect(mocks.pricing).not.toHaveBeenCalled()
})

test('unknown prices charge nothing, and durable callers cannot advance past them', async () => {
  const { policy, recordBatch } = durablePolicy()
  mocks.pricing.mockResolvedValue(null)
  expect(await policy.recordFinishedUsage(usage)).toEqual({ recorded: false, budgetLow: false })
  await expect(policy.recordFinishedUsage({ ...usage, requireRecorded: true })).rejects.toThrow(/pricing requires reconciliation/)
  expect(recordBatch).not.toHaveBeenCalled()
})

test('invalid provider cost and overlapping cache usage are rejected before billing', async () => {
  const { policy, recordBatch } = durablePolicy()
  for (const providerCostUsd of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
    await expect(policy.recordFinishedUsage({ ...usage, providerCostUsd })).rejects.toThrow('Invalid provider cost')
  }
  await expect(policy.recordFinishedUsage({ ...usage, cachedInputTokens: 900 })).rejects.toThrow('Invalid cached token')
  expect(recordBatch).not.toHaveBeenCalled()
  expect(mocks.pricing).not.toHaveBeenCalled()
})

test('internal model receipts preserve usage but do not consume another request allowance', async () => {
  const { policy, recordBatch } = durablePolicy()
  await policy.recordFinishedUsage({ ...usage, countAsRequest: false, requireRecorded: true,
    workspaceId: 'original-workspace', operationId: 'harness:root:model:1', providerCostUsd: 0 })
  expect(recordBatch).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: 'original-workspace', operationId: 'harness:root:model:1',
    events: [expect.objectContaining({ countAsRequest: false, providerCostUsd: 0, cachedTokens: 600, inputTokens: 1_000 })] }))
  recordBatch.mockRejectedValueOnce(new Error('database unavailable'))
  await expect(policy.recordFinishedUsage({ ...usage, requireRecorded: true })).rejects.toThrow(/could not be recorded/)
})

test('durable zero-usage calls are recorded, and a frozen catalog quote is not relabeled as exact provider cost', async () => {
  const { policy, recordBatch } = durablePolicy()
  await policy.recordFinishedUsage({ ...usage, inputTokens: 0, outputTokens: 0,
    cachedInputTokens: 0, cacheWriteTokens: 0, requireRecorded: true, catalogCostUsd: 0, operationId: 'zero' })
  expect(recordBatch).toHaveBeenCalledWith(expect.objectContaining({ events: [expect.objectContaining({ costCents: 0 })] }))
  await policy.recordFinishedUsage({ ...usage, requireRecorded: true, catalogCostUsd: 0.00082 })
  expect(recordBatch.mock.calls[1][0].events[0]).not.toHaveProperty('providerCostUsd')
  expect(mocks.pricing).not.toHaveBeenCalled()
  await expect(policy.recordFinishedUsage({ ...usage, catalogCostUsd: -1 })).rejects.toThrow(/catalog cost/)
})
