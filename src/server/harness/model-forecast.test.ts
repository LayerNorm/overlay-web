import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import type { LanguageModelV4CallOptions } from '@ai-sdk/provider'
import { estimateHarnessInputTokens, forecastHarnessModelCost, hasHarnessCacheWrites } from './model-forecast'

const mocks = vi.hoisted(() => ({ catalog: vi.fn() }))
vi.mock('server-only', () => ({}))
vi.mock('@/server/ai/gateway/gateway-catalog', () => ({ getGatewayCatalogModel: mocks.catalog }))
const request = { modelId: 'provider/model', inputTokenBudget: 100, maxOutputTokens: 50, cacheWrites: true }

beforeEach(() => { vi.resetAllMocks() })
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

test('expired endpoint quotes refresh and an unavailable refresh cannot use stale cheap prices', async () => {
  const gatewayId = 'fixture/expiring-prices'
  let now = 1_000_000
  vi.spyOn(Date, 'now').mockImplementation(() => now)
  mocks.catalog.mockResolvedValue({ type: 'language', gatewayId,
    pricing: { input: 0.000001, output: 0.000002, varies_by_provider: true } })
  const fetch = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ data: { id: gatewayId,
    endpoints: [{ pricing: { prompt: 0.000001, completion: 0.000002 } }] } })))
    .mockResolvedValueOnce(new Response('', { status: 503 }))
    .mockResolvedValueOnce(new Response(JSON.stringify({ data: { id: gatewayId,
      endpoints: [{ pricing: { prompt: 0.000003, completion: 0.000004 } }] } })))
  vi.stubGlobal('fetch', fetch)
  const quote = { ...request, cacheWrites: false }
  const initial = await forecastHarnessModelCost(quote)
  now += 5 * 60_000 + 1
  await expect(forecastHarnessModelCost(quote)).rejects.toThrow(/unavailable/)
  expect(await forecastHarnessModelCost(quote)).toBeGreaterThan(initial)
  expect(fetch).toHaveBeenCalledTimes(3)
})

test('provider-variable routing reserves above the headline rate before a summary dispatch', async () => {
  const gatewayId = 'deepseek/deepseek-v4.1-flash-1017'
  mocks.catalog.mockResolvedValue({ type: 'language', gatewayId, pricing: {
    input: '0.000000075', output: '0.0000003', varies_by_provider: true,
  } })
  const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: { id: gatewayId, endpoints: [
    { provider_name: 'pareto', pricing: { prompt: '0.000000075', completion: '0.0000003' } },
    { provider_name: 'fireworks', pricing: { prompt: '0.0000003', completion: '0.0000012', input_cache_read: '0.000000006' } },
  ] } })))
  vi.stubGlobal('fetch', fetch)
  const summary = { modelId: gatewayId, inputTokenBudget: 19_772, maxOutputTokens: 2_048, cacheWrites: false }
  const estimate = await forecastHarnessModelCost(summary)
  expect(estimate).toBeGreaterThanOrEqual(8_389)
  expect(estimate).toBeLessThanOrEqual(8_390)
  expect(estimate).toBeGreaterThan(6_292)
  expect(await forecastHarnessModelCost(summary)).toBe(estimate)
  expect(fetch).toHaveBeenCalledTimes(1)
  expect(fetch.mock.calls[0][0]).toBe(`https://ai-gateway.vercel.sh/v1/models/${gatewayId}/endpoints`)
})

test('reservation ceilings include peak, regional, fast and tier pricing without applying discounts', async () => {
  const gatewayId = 'fixture/price-variants'
  mocks.catalog.mockResolvedValue({ type: 'language', gatewayId, pricing: { input: 0.000001, output: 0.000002, varies_by_provider: true } })
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: { id: gatewayId, endpoints: [
    { pricing: { prompt: 0.000001, completion: 0.000002, discount: 0.9,
      peak_pricing: { multiplier: 2 }, regional: { us: { prompt: 0.000004 } },
      fast: { completion_tiers: [{ cost: 0.00001, min: 1_000 }] } } },
  ] } }))))
  const estimate = await forecastHarnessModelCost({ ...request, cacheWrites: false })
  expect(estimate).toBeGreaterThanOrEqual(1_800)
  expect(estimate).toBeLessThanOrEqual(1_801)
})

test('missing, malformed and unavailable endpoint pricing fail before inference, with no stale fallback', async () => {
  for (const [index, response] of [
    new Response('', { status: 503 }),
    new Response(JSON.stringify({ data: { id: 'wrong/model', endpoints: [{ pricing: { prompt: 1, completion: 1 } }] } })),
    new Response(JSON.stringify({ data: { id: 'fixture/missing-2', endpoints: [] } })),
    new Response(JSON.stringify({ data: { id: 'fixture/missing-3', endpoints: [{ pricing: { prompt: 1, completion: -1 } }] } })),
  ].entries()) {
    mocks.catalog.mockResolvedValue({ type: 'language', gatewayId: `fixture/missing-${index}`,
      pricing: { input: 0.000001, output: 0.000002, varies_by_provider: true } })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response))
    await expect(forecastHarnessModelCost({ ...request, cacheWrites: false })).rejects.toThrow()
  }
})

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
