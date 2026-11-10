import { beforeEach, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ price: vi.fn(), generation: vi.fn() }))
vi.mock('server-only', () => ({}))
vi.mock('@/server/ai/gateway/live-model-pricing', () => ({ calculateLanguageModelTokenCostOrNull: mocks.price }))
vi.mock('@/server/ai/gateway/gateway-runtime', () => ({ getOrCreateGateway: async () => ({ getGenerationInfo: mocks.generation }) }))
vi.mock('workflow', () => ({
  FatalError: class FatalError extends Error {},
  RetryableError: class RetryableError extends Error {},
  getStepMetadata: () => ({ attempt: 1 }),
}))

import { resolveHarnessModelUsage } from './usage-steps'

const input = {
  receiptId: 'model:0', requestedModelId: 'provider/model', contextWindow: 1_000,
  observation: { modelId: 'provider/model', provider: 'provider', inputTokens: 10, outputTokens: 2, reasoningTokens: 0,
    cacheReadTokens: 0, cacheWriteTokens: 0, generationId: 'gen-1' },
}
beforeEach(() => { vi.clearAllMocks() })

test('a known price settles immediately at catalog pricing', async () => {
  mocks.price.mockResolvedValue(0.002)
  const resolved = await resolveHarnessModelUsage(input)
  expect(mocks.generation).not.toHaveBeenCalled()
  expect(resolved).toMatchObject({ providerCostUsd: null, catalogCostUsd: 0.002,
    receipt: { costMicros: 2_000, costSource: 'catalog' } })
})

test('an unknown price still waits for the exact cost', async () => {
  mocks.price.mockResolvedValue(null)
  mocks.generation.mockResolvedValue({ id: 'gen-1', model: 'provider/model', providerName: 'provider', isByok: false, totalCost: 0.003 })
  const resolved = await resolveHarnessModelUsage(input)
  expect(resolved).toMatchObject({ providerCostUsd: 0.003, catalogCostUsd: null, receipt: { costSource: 'provider' } })
})

test('bring-your-own-key calls never look up a price', async () => {
  const resolved = await resolveHarnessModelUsage({ ...input, requestedModelId: 'byok/key/model' })
  expect(mocks.price).not.toHaveBeenCalled()
  expect(resolved.receipt).toMatchObject({ costMicros: 0, costSource: 'external' })
})
