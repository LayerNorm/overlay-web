import 'server-only'

import type { LanguageModelV4CallOptions } from '@ai-sdk/provider'
import { FatalError } from 'workflow'
import { getGatewayCatalogModel } from '@/server/ai/gateway/gateway-catalog'
import { isByokModelId } from '@/shared/ai/gateway/byok-model-conversion'
import { isFreeTierChatModelId } from '@/shared/ai/gateway/model-types'
import { harnessCostMicros } from './model-usage'

function positiveInteger(value: number) {
  if (!Number.isSafeInteger(value) || value <= 0) throw new FatalError('Model limits must be positive integers.')
}

export function estimateHarnessInputTokens(options: LanguageModelV4CallOptions, contextWindow: number | null): number {
  const prompt = JSON.stringify({ prompt: options.prompt, tools: options.tools })
  const bytes = Buffer.byteLength(prompt, 'utf8')
  const hasMedia = options.prompt.some(message => Array.isArray(message.content) && message.content.some(part =>
    part.type === 'file' || (part.type === 'tool-result' && part.output.type === 'content')))
  if (hasMedia) {
    if (contextWindow === null) throw new FatalError('Media inference requires a known context limit.')
    positiveInteger(contextWindow)
    return contextWindow
  }
  // A conservative byte-based estimate, not a claim to be a provider tokenizer.
  return bytes + 1_024 + options.prompt.length * 32 + (options.tools?.length ?? 0) * 128
}

function maximumRate(pricing: Record<string, unknown>, key: string, required: boolean): number | null {
  const values: unknown[] = []
  if (pricing[key] !== undefined) values.push(pricing[key])
  const tiers = pricing[`${key}_tiers`]
  if (tiers !== undefined) {
    if (!Array.isArray(tiers)) throw new FatalError('Invalid model pricing tiers.')
    for (const tier of tiers) {
      if (!tier || typeof tier !== 'object' || !('cost' in tier)) throw new FatalError('Invalid model pricing tier.')
      values.push(tier.cost)
    }
  }
  if (!values.length) {
    if (required) throw new FatalError('Model pricing is unavailable.')
    return null
  }
  const rates = values.map(value => {
    if ((typeof value !== 'number' && typeof value !== 'string') || String(value).trim() === '') throw new FatalError('Invalid model token price.')
    const number = Number(value)
    if (!Number.isFinite(number) || number < 0) throw new FatalError('Invalid model token price.')
    return number
  })
  return Math.max(...rates)
}

export async function forecastHarnessModelCost(input: {
  modelId: string
  inputTokenBudget: number
  maxOutputTokens: number
  cacheWrites: boolean
}): Promise<number> {
  'use step'

  positiveInteger(input.inputTokenBudget)
  positiveInteger(input.maxOutputTokens)
  if (isByokModelId(input.modelId)) return 0
  if (isFreeTierChatModelId(input.modelId)) {
    if (input.cacheWrites) throw new FatalError('Explicit cache writes are not priced for the free router.')
    return 0
  }
  const model = await getGatewayCatalogModel(input.modelId)
  if (!model || model.type !== 'language') throw new FatalError('Language model pricing is unavailable.')
  const inputRate = maximumRate(model.pricing, 'input', true)!
  const readRate = maximumRate(model.pricing, 'input_cache_read', false) ?? inputRate
  const writeRate = maximumRate(model.pricing, 'input_cache_write', input.cacheWrites) ?? inputRate
  const outputRate = maximumRate(model.pricing, 'output', true)!
  return harnessCostMicros(input.inputTokenBudget * Math.max(inputRate, readRate, writeRate) + input.maxOutputTokens * outputRate)
}

export function hasHarnessCacheWrites(options: LanguageModelV4CallOptions): boolean {
  const hasCacheControl = (value: unknown): boolean => {
    if (!value || typeof value !== 'object') return false
    if ('cacheControl' in value || 'cache_control' in value) {
      const control = 'cacheControl' in value ? value.cacheControl : value.cache_control
      if (!control || typeof control !== 'object' || !('type' in control) || control.type !== 'ephemeral'
        || ('ttl' in control && control.ttl !== '5m')) throw new FatalError('This cache-write configuration has no authorized price.')
      return true
    }
    return Object.values(value).map(hasCacheControl).some(Boolean)
  }
  const configured = [options.providerOptions,
    ...options.prompt.flatMap(message => [message.providerOptions,
      ...(Array.isArray(message.content) ? message.content.map(part => part.providerOptions) : [])]),
    ...(options.tools ?? []).map(tool => 'providerOptions' in tool ? tool.providerOptions : undefined),
  ]
  return configured.map(hasCacheControl).some(Boolean)
}
