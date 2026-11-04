import { beforeEach, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ generation: vi.fn(), correct: vi.fn(), attempt: 1 }))
vi.mock('server-only', () => ({}))
vi.mock('@/server/observability/logger', () => ({ logger: { warn: vi.fn() } }))
vi.mock('@/server/ai/gateway/live-model-pricing', () => ({ calculateLanguageModelTokenCostOrNull: vi.fn() }))
vi.mock('@/server/ai/gateway/gateway-runtime', () => ({ getOrCreateGateway: async () => ({ getGenerationInfo: mocks.generation }) }))
vi.mock('@/server/billing/billing-runtime', () => ({ correctProviderBudgetReservationCost: mocks.correct }))
vi.mock('workflow', () => ({
  FatalError: class FatalError extends Error {},
  RetryableError: class RetryableError extends Error {},
  getStepMetadata: () => ({ attempt: mocks.attempt }),
}))

import { correctHarnessModelCost } from './cost-correction-step'

const input = { actorUserId: 'user', generationId: 'gen-1', reservationId: 'hold' }
beforeEach(() => { vi.clearAllMocks(); mocks.attempt = 1 })

test('the exact cost corrects the settled estimate', async () => {
  mocks.generation.mockResolvedValue({ id: 'gen-1', isByok: false, totalCost: 0.003 })
  await correctHarnessModelCost(input)
  expect(mocks.correct).toHaveBeenCalledWith({ userId: 'user', reservationId: 'hold', actualProviderCostUsd: 0.003 })
})

test('usage that has not appeared yet retries, then the estimate stands', async () => {
  mocks.generation.mockRejectedValue(Object.assign(new Error('missing'), { statusCode: 404 }))
  await expect(correctHarnessModelCost(input)).rejects.toThrow('not been ingested')
  mocks.attempt = 99
  await expect(correctHarnessModelCost(input)).resolves.toBeUndefined()
  expect(mocks.correct).not.toHaveBeenCalled()
})

test('other gateway errors and mismatched usage never change the charge', async () => {
  mocks.generation.mockRejectedValueOnce(Object.assign(new Error('down'), { statusCode: 500 }))
  await expect(correctHarnessModelCost(input)).rejects.toThrow('the estimate stands')
  for (const usage of [{ id: 'other', isByok: false, totalCost: 9 }, { id: 'gen-1', isByok: true, totalCost: 9 }]) {
    mocks.generation.mockResolvedValueOnce(usage)
    await correctHarnessModelCost(input)
  }
  expect(mocks.correct).not.toHaveBeenCalled()
})
