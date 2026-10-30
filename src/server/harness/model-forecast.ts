import 'server-only'

import type { LanguageModelV4CallOptions } from '@ai-sdk/provider'
import { FatalError } from 'workflow'
import { getGatewayCatalogModel } from '@/server/ai/gateway/gateway-catalog'
import { languageModelReservationCost } from '@/server/ai/gateway/model-reservation-pricing'
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
  return harnessCostMicros(await languageModelReservationCost(model, input.inputTokenBudget, input.maxOutputTokens, input.cacheWrites))
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
