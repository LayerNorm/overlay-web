import 'server-only'

import type { GatewayCatalogModel } from '@/shared/ai/gateway/gateway-catalog'

type Pricing = Record<string, unknown>
const endpointCache = new Map<string, { expiresAt: number; pricing: Pricing[] }>()
const pending = new Map<string, Promise<Pricing[]>>()

function record(value: unknown): Pricing {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid model reservation pricing.')
  return value as Pricing
}

function price(value: unknown): number {
  if ((typeof value !== 'number' && typeof value !== 'string') || String(value).trim() === '') {
    throw new Error('Missing model reservation price.')
  }
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error('Invalid model reservation price.')
  return parsed
}

function maximumRate(pricing: Pricing, key: string, required: boolean): number | null {
  const values: number[] = []
  if (pricing[key] !== undefined) values.push(price(pricing[key]))
  const tiers = pricing[`${key}_tiers`]
  if (tiers !== undefined) {
    if (!Array.isArray(tiers) || !tiers.length) throw new Error('Invalid model reservation price tiers.')
    for (const tier of tiers) values.push(price(record(tier).cost))
  }
  if (!values.length) {
    if (required) throw new Error('Missing model reservation price.')
    return null
  }
  return Math.max(...values)
}

function variants(pricing: Pricing): Pricing[] {
  const result = [pricing]
  if (pricing.fast !== undefined) result.push({ ...pricing, ...record(pricing.fast) })
  if (pricing.regional !== undefined) {
    for (const regional of Object.values(record(pricing.regional))) {
      result.push({ ...pricing, ...record(regional) })
    }
  }
  return result
}

// Reservation ceilings only: never use these maximum rates as an actual charge.
export function maximumLanguageReservationCost(
  prices: Pricing[], inputTokens: number, outputTokens: number, cacheWrites: boolean,
): number {
  if (![inputTokens, outputTokens].every(value => Number.isSafeInteger(value) && value >= 0) || !prices.length) {
    throw new Error('Invalid model reservation quantities.')
  }
  let inputRate = 0
  let outputRate = 0
  let requestRate = 0
  let multiplier = 1
  for (const pricing of prices.flatMap(variants)) {
    const input = maximumRate(pricing, 'input', true)!
    const read = maximumRate(pricing, 'input_cache_read', false) ?? input
    const write = maximumRate(pricing, 'input_cache_write', cacheWrites) ?? input
    const output = maximumRate(pricing, 'output', true)!
    const request = maximumRate(pricing, 'request', false) ?? 0
    const peak = pricing.peak_pricing === undefined ? 1 : Math.max(1, price(record(pricing.peak_pricing).multiplier))
    inputRate = Math.max(inputRate, input, read, write)
    outputRate = Math.max(outputRate, output)
    requestRate = Math.max(requestRate, request)
    multiplier = Math.max(multiplier, peak)
  }
  const maximum = (inputTokens * inputRate + outputTokens * outputRate + requestRate) * multiplier
  if (!Number.isFinite(maximum)) throw new Error('Invalid model reservation cost.')
  return maximum
}

function normalizeEndpointPricing(value: unknown): Pricing {
  const pricing = record(value)
  const normalized: Pricing = { ...pricing }
  for (const [source, target] of [['prompt', 'input'], ['completion', 'output'],
    ['prompt_tiers', 'input_tiers'], ['completion_tiers', 'output_tiers']]) {
    if (pricing[source] !== undefined) normalized[target] = pricing[source]
  }
  if (pricing.fast !== undefined) normalized.fast = normalizeEndpointPricing(pricing.fast)
  if (pricing.regional !== undefined) {
    normalized.regional = Object.fromEntries(Object.entries(record(pricing.regional))
      .map(([region, rates]) => [region, normalizeEndpointPricing(rates)]))
  }
  return normalized
}

async function fetchEndpointPricing(gatewayId: string): Promise<Pricing[]> {
  const response = await fetch(`https://ai-gateway.vercel.sh/v1/models/${gatewayId.split('/').map(encodeURIComponent).join('/')}/endpoints`, {
    signal: AbortSignal.timeout(10_000),
  })
  if (!response.ok) throw new Error('Model endpoint pricing is unavailable.')
  const data = record(record(await response.json()).data)
  if (data.id !== gatewayId || !Array.isArray(data.endpoints) || !data.endpoints.length) {
    throw new Error('Model endpoint pricing is missing or mismatched.')
  }
  const pricing = data.endpoints.map(endpoint => normalizeEndpointPricing(record(endpoint).pricing))
  // Validate before caching, including a nonzero quantity for both token types.
  maximumLanguageReservationCost(pricing, 1, 1, false)
  if (endpointCache.size >= 256) endpointCache.clear()
  endpointCache.set(gatewayId, { pricing, expiresAt: Date.now() + 5 * 60_000 })
  return pricing
}

async function endpointPricing(gatewayId: string): Promise<Pricing[]> {
  const cached = endpointCache.get(gatewayId)
  if (cached && cached.expiresAt > Date.now()) return cached.pricing
  let request = pending.get(gatewayId)
  if (!request) {
    request = fetchEndpointPricing(gatewayId).finally(() => pending.delete(gatewayId))
    pending.set(gatewayId, request)
  }
  return await request
}

export async function languageModelReservationCost(
  model: GatewayCatalogModel, inputTokens: number, outputTokens: number, cacheWrites = false,
): Promise<number> {
  const prices = [model.pricing]
  if (model.pricing.varies_by_provider === true) prices.push(...await endpointPricing(model.gatewayId))
  return maximumLanguageReservationCost(prices, inputTokens, outputTokens, cacheWrites)
}
