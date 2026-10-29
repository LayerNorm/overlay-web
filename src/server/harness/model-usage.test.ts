import { beforeEach, expect, test, vi } from 'vitest'
import type { WorkflowAgentOnStepEndCallback } from '@ai-sdk/workflow'
import type { ToolSet } from 'ai'
import { captureHarnessModelUsage, harnessCostMicros } from './model-usage'
import { resolveHarnessModelUsage } from './usage-steps'

const mocks = vi.hoisted(() => ({ generation: vi.fn(), pricing: vi.fn(), attempt: 1 }))
vi.mock('server-only', () => ({}))
vi.mock('@/server/ai/gateway/gateway-runtime', () => ({ getOrCreateGateway: async () => ({ getGenerationInfo: mocks.generation }) }))
vi.mock('@/server/ai/gateway/live-model-pricing', () => ({ calculateLanguageModelTokenCostOrNull: mocks.pricing }))
vi.mock('workflow', async importOriginal => {
  const actual = await importOriginal<typeof import('workflow')>()
  return {
    ...actual,
    getStepMetadata: () => ({ attempt: mocks.attempt }) as ReturnType<typeof actual.getStepMetadata>,
  }
})

const step = {
  usage: { inputTokens: 1_000, outputTokens: 100, inputTokenDetails: { cacheReadTokens: 600, cacheWriteTokens: 200 }, outputTokenDetails: { reasoningTokens: 20 } },
  providerMetadata: { gateway: { generationId: 'gen_fixture', routing: { canonicalSlug: 'provider/actual', finalProvider: 'provider' },
    asyncJob: { webhookSigningSecret: 'fixture-do-not-store' }, unrelated: 'fixture-do-not-store' } },
} as unknown as Parameters<WorkflowAgentOnStepEndCallback<ToolSet>>[0]
const request = () => ({ receiptId: 'model:0', requestedModelId: 'provider/requested', contextWindow: 100_000,
  observation: captureHarnessModelUsage(step, 'provider/requested') })

beforeEach(() => { vi.clearAllMocks(); mocks.attempt = 1 })

async function retryDelaySeconds(input: ReturnType<typeof request>): Promise<number> {
  let thrown: unknown
  try {
    await resolveHarnessModelUsage(input)
  } catch (error) {
    thrown = error
  }
  expect(thrown).toMatchObject({ name: 'RetryableError' })
  const retryAfter = (thrown as { retryAfter?: Date }).retryAfter
  expect(retryAfter).toBeInstanceOf(Date)
  return Math.ceil((retryAfter!.getTime() - Date.now()) / 1_000)
}

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
  expect(await retryDelaySeconds(request())).toBe(2)
  mocks.generation.mockRejectedValue({ statusCode: 403 })
  await expect(resolveHarnessModelUsage(request())).rejects.toMatchObject({ name: 'FatalError' })
  expect(mocks.pricing).not.toHaveBeenCalled()
})

test('a delayed Gateway receipt eventually resolves to a provider receipt', async () => {
  mocks.generation.mockRejectedValueOnce({ statusCode: 404 }).mockResolvedValue({
    id: 'gen_fixture', model: 'provider/actual', providerName: 'provider', isByok: false, totalCost: 0.00071,
  })
  expect(await retryDelaySeconds(request())).toBe(2)
  mocks.attempt = 2
  const result = await resolveHarnessModelUsage(request())
  expect(result.receipt).toMatchObject({ costSource: 'provider', costMicros: 710 })
  expect(result.providerCostUsd).toBe(0.00071)
  expect(mocks.generation).toHaveBeenCalledTimes(2)
  expect(mocks.pricing).not.toHaveBeenCalled()
})

test('404s retry with growing delays before settling from catalog pricing', async () => {
  mocks.generation.mockRejectedValue({ statusCode: 404 })
  mocks.pricing.mockResolvedValue(0.00071)
  const delays: number[] = []
  for (let attempt = 1; attempt <= 14; attempt++) {
    mocks.attempt = attempt
    delays.push(await retryDelaySeconds(request()))
  }
  expect(delays).toEqual([2, 4, 8, 16, 32, ...Array(9).fill(60)])
  expect(resolveHarnessModelUsage.maxRetries).toBe(14)

  mocks.attempt = 15
  const result = await resolveHarnessModelUsage(request())
  expect(result).toMatchObject({
    receipt: { costSource: 'catalog', costMicros: 710, inputTokens: 1_000, outputTokens: 100 },
    providerCostUsd: null,
    catalogCostUsd: 0.00071,
  })
  expect(mocks.pricing).toHaveBeenCalledWith('provider/actual', 1_000, 600, 100, 200)
})

test('an exhausted Gateway 404 with unknown catalog pricing remains fatal', async () => {
  mocks.attempt = 15
  mocks.generation.mockRejectedValue({ statusCode: 404 })
  mocks.pricing.mockResolvedValue(null)
  await expect(resolveHarnessModelUsage(request())).rejects.toMatchObject({ name: 'FatalError' })
})

test('catalog fallback is explicitly an estimate and missing prices never become free receipts', async () => {
  const input = request()
  delete input.observation.generationId
  mocks.pricing.mockResolvedValue(0.00071)
  const estimated = await resolveHarnessModelUsage(input)
  expect(estimated.receipt).toMatchObject({ costSource: 'catalog', costMicros: 710 })
  expect(estimated.providerCostUsd).toBeNull()
  expect(estimated.catalogCostUsd).toBe(0.00071)
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
