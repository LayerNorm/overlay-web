import { beforeEach, expect, test, vi } from 'vitest'
import type { WorkflowAgentOnStepEndCallback } from '@ai-sdk/workflow'
import type { ToolSet } from 'ai'
import { captureHarnessModelUsage, harnessCostMicros } from './model-usage'
import { resolveHarnessModelUsage } from './usage-steps'

const mocks = vi.hoisted(() => ({ generation: vi.fn(), pricing: vi.fn() }))
vi.mock('server-only', () => ({}))
vi.mock('@/server/ai/gateway/gateway-runtime', () => ({ getOrCreateGateway: async () => ({ getGenerationInfo: mocks.generation }) }))
vi.mock('@/server/ai/gateway/live-model-pricing', () => ({ calculateLanguageModelTokenCostOrNull: mocks.pricing }))

const step = {
  usage: { inputTokens: 1_000, outputTokens: 100, inputTokenDetails: { cacheReadTokens: 600, cacheWriteTokens: 200 }, outputTokenDetails: { reasoningTokens: 20 } },
  providerMetadata: { gateway: { generationId: 'gen_fixture', routing: { canonicalSlug: 'provider/actual', finalProvider: 'provider' },
    asyncJob: { webhookSigningSecret: 'fixture-do-not-store' }, unrelated: 'fixture-do-not-store' } },
} as unknown as Parameters<WorkflowAgentOnStepEndCallback<ToolSet>>[0]
const request = () => ({ receiptId: 'model:0', requestedModelId: 'provider/requested', contextWindow: 100_000,
  observation: captureHarnessModelUsage(step, 'provider/requested') })

beforeEach(() => { vi.clearAllMocks() })

test('allows only normalized token counts and routing references across the durable boundary', () => {
  expect(captureHarnessModelUsage(step, 'provider/requested')).toEqual({ modelId: 'provider/actual', provider: 'provider',
    inputTokens: 1_000, outputTokens: 100, reasoningTokens: 20, cacheReadTokens: 600, cacheWriteTokens: 200, generationId: 'gen_fixture' })
  expect(JSON.stringify(request())).not.toContain('fixture-do-not-store')
  expect(() => captureHarnessModelUsage({ ...step, usage: { ...step.usage, inputTokens: undefined } }, 'provider/requested')).toThrow(/missing/)
  expect(() => captureHarnessModelUsage({ ...step, usage: { ...step.usage, inputTokens: 700 } }, 'provider/requested')).toThrow(/cache counts/)
})

test('uses exact Gateway receipts, including zero, without persisting unrelated generation data', async () => {
  for (const totalCost of [0.00071, 0]) {
    mocks.generation.mockResolvedValue({ id: 'gen_fixture', model: 'provider/actual', providerName: 'provider', isByok: false, totalCost,
      extra: 'fixture-do-not-store' })
    const result = await resolveHarnessModelUsage(request())
    expect(result.providerCostUsd).toBe(totalCost)
    expect(result.receipt).toMatchObject({ costMicros: totalCost === 0 ? 0 : 710, costSource: 'provider', cacheReadTokens: 600, cacheWriteTokens: 200 })
    expect(JSON.stringify(result)).not.toContain('fixture-do-not-store')
  }
  expect(mocks.pricing).not.toHaveBeenCalled()
})

test('delayed receipt ingestion retries only lookup, while other lookup failures require reconciliation', async () => {
  mocks.generation.mockRejectedValue({ statusCode: 404 })
  await expect(resolveHarnessModelUsage(request())).rejects.toMatchObject({ name: 'RetryableError' })
  mocks.generation.mockRejectedValue({ statusCode: 403 })
  await expect(resolveHarnessModelUsage(request())).rejects.toMatchObject({ name: 'FatalError' })
  expect(mocks.pricing).not.toHaveBeenCalled()
})

test('catalog fallback is explicitly an estimate and missing prices never become free receipts', async () => {
  const input = request()
  delete input.observation.generationId
  mocks.pricing.mockResolvedValue(0.00071)
  expect((await resolveHarnessModelUsage(input)).receipt).toMatchObject({ costSource: 'catalog', costMicros: 710 })
  expect(mocks.pricing).toHaveBeenCalledWith('provider/actual', 1_000, 600, 100, 200)
  mocks.pricing.mockResolvedValue(null)
  await expect(resolveHarnessModelUsage(input)).rejects.toThrow(/unknown/)
})

test('BYOK has no Overlay charge but preserves an unknown external cost and cannot trigger platform receipt lookup', async () => {
  const result = await resolveHarnessModelUsage({ ...request(), requestedModelId: 'byok/connection/model' })
  expect(result).toMatchObject({ providerCostUsd: null, receipt: { costMicros: 0, costSource: 'external', externalCostMicros: null } })
  expect(mocks.generation).not.toHaveBeenCalled()
  expect(mocks.pricing).not.toHaveBeenCalled()
})

test('rejects invalid costs and receipts from another generation or funding source', async () => {
  for (const cost of [-1, NaN, Infinity, Number.MAX_SAFE_INTEGER]) expect(() => harnessCostMicros(cost)).toThrow(/cost/)
  for (const extra of [{ id: 'gen_other' }, { isByok: true }]) {
    mocks.generation.mockResolvedValue({ id: 'gen_fixture', model: 'provider/actual', providerName: 'provider', isByok: false, totalCost: 0, ...extra })
    await expect(resolveHarnessModelUsage(request())).rejects.toThrow(/reconciliation/)
  }
})
