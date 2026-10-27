import 'server-only'

import type { LanguageModelV4CallOptions } from '@ai-sdk/provider'
import { FatalError } from 'workflow'
import { getGatewayCatalogModel } from '@/server/ai/gateway/gateway-catalog'
import { modelSupportsZeroDataRetention } from '@/shared/ai/gateway/model-data'
import { estimateHarnessInputTokens, forecastHarnessModelCost, hasHarnessCacheWrites } from './model-forecast'

// Quote inside a server step after compiling the exact prompt and tool schemas.
// Dispatch reauthorizes and claims its account reservation before inference.
export async function quoteHarnessModel(input: {
  modelId: string
  requiresZeroDataRetention?: boolean
  options: LanguageModelV4CallOptions
}) {
  const maxOutputTokens = input.options.maxOutputTokens
  if (!Number.isSafeInteger(maxOutputTokens) || maxOutputTokens! <= 0) {
    throw new FatalError('A positive model output limit is required before dispatch.')
  }
  if (input.options.tools?.some(tool => tool.type === 'provider')) {
    throw new FatalError('Provider-executed tools require separate spend authorization.')
  }
  for (const routing of [input.options.providerOptions?.gateway, input.options.providerOptions?.openrouter]) {
    if (routing?.models !== undefined && (!Array.isArray(routing.models) || routing.models.length > 0)) {
      throw new FatalError('Model fallback must be selected before preparing dispatch.')
    }
  }
  const catalog = await getGatewayCatalogModel(input.modelId)
  const contextWindow = catalog?.type === 'language' && Number.isSafeInteger(catalog.contextWindow) && catalog.contextWindow! > 0
    ? catalog.contextWindow! : null
  if (catalog?.maxTokens !== undefined && (!Number.isSafeInteger(catalog.maxTokens) || catalog.maxTokens <= 0 || maxOutputTokens! > catalog.maxTokens)) {
    throw new FatalError('The output limit exceeds the selected model capacity.')
  }
  const options: LanguageModelV4CallOptions = {
    ...input.options,
    ...(input.requiresZeroDataRetention || modelSupportsZeroDataRetention(input.modelId) ? { providerOptions: {
      ...input.options.providerOptions,
      gateway: { ...input.options.providerOptions?.gateway, zeroDataRetention: true },
    } } : {}),
  }
  const inputTokenBudget = estimateHarnessInputTokens(options, contextWindow)
  const estimatedCostMicros = await forecastHarnessModelCost({
    modelId: input.modelId, inputTokenBudget, maxOutputTokens: maxOutputTokens!,
    cacheWrites: hasHarnessCacheWrites(options),
  })
  return { options, contextWindow, estimatedCostMicros, inputTokenBudget, maxOutputTokens: maxOutputTokens! }
}
