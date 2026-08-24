import { isFreeTierChatModelId } from '@/shared/ai/gateway/model-types'

export type GatewayPricingTier = {
  cost: string | number
  min?: number
  max?: number
}

export type GatewayVideoDurationPrice = {
  cost_per_second?: string | number
  resolution?: string
  mode?: string
  audio?: boolean
}

export type ProviderCostEstimate = {
  providerCostUsd: number
  pricingModelId: string
  pricingSource: 'gateway-api' | 'manual-override' | 'explicit-free'
  pricingType: 'language' | 'image' | 'video' | 'embedding' | 'browser-use' | 'transcription'
}

export type GatewayImageTokenUsage = {
  inputTokens: number | undefined
  outputTokens: number | undefined
}

// Image providers with token pricing do not expose the final token count until
// generation completes. Reserve enough for a high-detail image, then finalize
// against the provider-reported usage.
export const IMAGE_GENERATION_RESERVATION_USAGE: GatewayImageTokenUsage = {
  inputTokens: 8_192,
  outputTokens: 8_192,
}

export interface BrowserUseV3Pricing {
  inputPer1M: number
  outputPer1M: number
}

export const BROWSER_USE_TASK_INIT_USD = 0.01

export const BROWSER_USE_V3_MODEL_PRICING: Record<'bu-mini' | 'bu-max', BrowserUseV3Pricing> = {
  'bu-mini': { inputPer1M: 0.72, outputPer1M: 4.2 },
  'bu-max': { inputPer1M: 3.6, outputPer1M: 18.0 },
}

function parsePrice(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value !== 'string' || value.trim() === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function parseTierArray(value: unknown): GatewayPricingTier[] | undefined {
  if (!Array.isArray(value)) return undefined
  const tiers = value
    .map((tier): GatewayPricingTier | null => {
      if (!tier || typeof tier !== 'object') return null
      const raw = tier as Record<string, unknown>
      const cost = parsePrice(raw.cost)
      if (cost === null) return null
      return {
        cost,
        min: typeof raw.min === 'number' ? raw.min : undefined,
        max: typeof raw.max === 'number' ? raw.max : undefined,
      }
    })
    .filter((tier): tier is GatewayPricingTier => Boolean(tier))
    .sort((a, b) => (a.min ?? 0) - (b.min ?? 0))
  return tiers.length > 0 ? tiers : undefined
}

function tieredTokenCost(tokens: number, basePerToken: number | null, rawTiers: unknown): number | null {
  const safeTokens = Math.max(0, Math.ceil(tokens))
  if (safeTokens === 0) return 0
  const tiers = parseTierArray(rawTiers)
  if (!tiers) return basePerToken === null ? null : safeTokens * basePerToken

  let total = 0
  for (const tier of tiers) {
    const min = Math.max(0, tier.min ?? 0)
    const max = tier.max ?? Number.POSITIVE_INFINITY
    if (safeTokens <= min) continue
    total += Math.max(0, Math.min(safeTokens, max) - min) * Number(tier.cost)
  }
  if (total === 0 && basePerToken !== null) return safeTokens * basePerToken
  return total
}

export function calculateGatewayLanguageTokenCostOrNull(
  pricing: Record<string, unknown>,
  inputTokens: number,
  cachedInputTokens: number,
  outputTokens: number,
): number | null {
  const uncachedInputTokens = Math.max(0, inputTokens - cachedInputTokens)
  const input = tieredTokenCost(uncachedInputTokens, parsePrice(pricing.input), pricing.input_tiers)
  const cachedInput = tieredTokenCost(
    cachedInputTokens,
    parsePrice(pricing.input_cache_read) ?? parsePrice(pricing.input),
    pricing.input_cache_read_tiers,
  )
  const output = tieredTokenCost(outputTokens, parsePrice(pricing.output), pricing.output_tiers)
  if (input === null || cachedInput === null || output === null) return null
  return input + cachedInput + output
}

export function calculateGatewayEmbeddingCostOrNull(
  pricing: Record<string, unknown>,
  inputTokens: number,
): number | null {
  return tieredTokenCost(inputTokens, parsePrice(pricing.input), pricing.input_tiers)
}

export function calculateGatewayImageCostOrNull(
  _modelId: string,
  pricing: Record<string, unknown>,
  usage?: GatewayImageTokenUsage,
): number | null {
  const flatImagePrice = parsePrice(pricing.image)
  if (flatImagePrice !== null) return flatImagePrice
  if (usage?.inputTokens === undefined || usage.outputTokens === undefined) return null

  const input = tieredTokenCost(
    usage.inputTokens,
    parsePrice(pricing.input),
    pricing.input_tiers,
  )
  const output = tieredTokenCost(
    usage.outputTokens,
    parsePrice(pricing.output),
    pricing.output_tiers,
  )
  if (input === null || output === null) return null
  return input + output
}

function highestVideoDurationRate(pricing: Record<string, unknown>): number | null {
  if (!Array.isArray(pricing.video_duration_pricing)) return null
  let highest: number | null = null
  for (const row of pricing.video_duration_pricing) {
    if (!row || typeof row !== 'object') continue
    const cost = parsePrice((row as GatewayVideoDurationPrice).cost_per_second)
    if (cost !== null) highest = highest === null ? cost : Math.max(highest, cost)
  }
  return highest
}

export function calculateGatewayVideoCostOrNull(
  pricing: Record<string, unknown>,
  durationSeconds: number,
): number | null {
  const safeDuration = Math.max(1, Math.ceil(durationSeconds))
  const durationRate = highestVideoDurationRate(pricing)
  if (durationRate !== null) return durationRate * safeDuration
  return parsePrice(pricing.video)
}

export function calculateBrowserUseV3TokenCost(
  modelId: 'bu-mini' | 'bu-max',
  inputTokens: number,
  outputTokens: number,
): number {
  const pricing = BROWSER_USE_V3_MODEL_PRICING[modelId]
  return (Math.max(0, inputTokens) / 1_000_000) * pricing.inputPer1M +
    (Math.max(0, outputTokens) / 1_000_000) * pricing.outputPer1M
}

export function isExplicitFreeModel(modelId: string): boolean {
  return isFreeTierChatModelId(modelId)
}

export function isPremiumModel(modelId: string): boolean {
  return !isExplicitFreeModel(modelId)
}
