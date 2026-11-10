import 'server-only'

import type { LanguageModelV4CallOptions } from '@ai-sdk/provider'
import { FatalError } from 'workflow'
import { getGatewayCatalogModel } from '@/server/ai/gateway/gateway-catalog'
import { modelSupportsZeroDataRetention } from '@/shared/ai/gateway/model-data'
import { isRetiredHostedModelId } from '@/shared/ai/gateway/model-types'

// Runs inside a server step after compiling the exact prompt and tool schemas.
// It never estimates cost: the workspace budget is checked at dispatch and the
// actual cost is charged afterwards.
export async function prepareHarnessModelCallOptions(input: {
  modelId: string
  requiresZeroDataRetention?: boolean
  options: LanguageModelV4CallOptions
}) {
  if (isRetiredHostedModelId(input.modelId)) throw new FatalError('This hosted model is retired.')
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
  // The provider's own hard output limit, not a spending estimate.
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
  return { options, contextWindow, maxOutputTokens: maxOutputTokens! }
}
