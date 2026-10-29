import { beforeEach, expect, test, vi } from 'vitest'
import type { LanguageModelV4CallOptions } from '@ai-sdk/provider'
import { estimateHarnessInputTokens, forecastHarnessModelCost, hasHarnessCacheWrites } from './model-forecast'

const mocks = vi.hoisted(() => ({ catalog: vi.fn() }))
vi.mock('server-only', () => ({}))
vi.mock('@/server/ai/gateway/gateway-catalog', () => ({ getGatewayCatalogModel: mocks.catalog }))
const request = { modelId: 'provider/model', inputTokenBudget: 100, maxOutputTokens: 50, cacheWrites: true }

beforeEach(() => { vi.resetAllMocks() })

test('reserves at the highest input, cache-write and output tier rates', async () => {
  mocks.catalog.mockResolvedValue({ type: 'language', pricing: { input: 0.000001, input_cache_read: 0.0000001,
    input_cache_write: 0.000003, output: 0.000002, output_tiers: [{ cost: 0.000007, min: 1_000 }] } })
  const estimate = await forecastHarnessModelCost(request)
  expect(estimate).toBeGreaterThanOrEqual(650)
  expect(estimate).toBeLessThanOrEqual(651)
})

test('unknown or negative prices fail closed, while BYOK and the free router have no Overlay cost', async () => {
  for (const pricing of [{ input: 1, output: 1 }, { input: -1, input_cache_write: 1, output: 1 }]) {
    mocks.catalog.mockResolvedValue({ type: 'language', pricing })
    await expect(forecastHarnessModelCost(request)).rejects.toThrow()
  }
  expect(await forecastHarnessModelCost({ ...request, modelId: 'byok/connection/model' })).toBe(0)
  expect(await forecastHarnessModelCost({ ...request, modelId: 'openrouter/free', cacheWrites: false })).toBe(0)
  await expect(forecastHarnessModelCost({ ...request, modelId: 'openrouter/free' })).rejects.toThrow(/cache writes/)
  await expect(forecastHarnessModelCost({ ...request, inputTokenBudget: -1 })).rejects.toThrow(/limits/)
})

test('text forecasts include byte and protocol overhead, while media requires a known context limit', () => {
  const options: LanguageModelV4CallOptions = { prompt: [{ role: 'user', content: [{ type: 'text', text: 'Hello 世界' }] }] }
  expect(estimateHarnessInputTokens(options, null)).toBeGreaterThan(1_024 + Buffer.byteLength(JSON.stringify(options)))
  const media: LanguageModelV4CallOptions = { prompt: [{ role: 'user', content: [{ type: 'file', data: new URL('https://example.com/image.png'), mediaType: 'image/png' }] }] }
  expect(estimateHarnessInputTokens(media, 10_000)).toBe(10_000)
  expect(() => estimateHarnessInputTokens(media, null)).toThrow(/context limit/)
})

test('only priced ephemeral cache configurations are accepted across all breakpoints', () => {
  const options: LanguageModelV4CallOptions = { prompt: [], providerOptions: { anthropic: { cacheControl: { type: 'ephemeral' } } } }
  expect(hasHarnessCacheWrites(options)).toBe(true)
  expect(hasHarnessCacheWrites({ prompt: [] })).toBe(false)
  expect(() => hasHarnessCacheWrites({ ...options, prompt: [{ role: 'system', content: 'system', providerOptions: {
    anthropic: { cacheControl: { type: 'ephemeral', ttl: '1h' } },
  } }] })).toThrow(/authorized price/)
})
