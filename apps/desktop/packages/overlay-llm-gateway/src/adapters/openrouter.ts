import { createOpenRouter } from '@openrouter/ai-sdk-provider'
import type { LanguageModel, LLMGateway, ModelInfo, ModelOptions, PricingInfo } from '../contracts'
import { listModelInfo } from '../models'
import { pricingFromCatalog, resolveProviderApiKey, type ProviderGatewayOptions } from './common'

export interface OpenRouterGatewayOptions extends ProviderGatewayOptions {
  appTitle?: string
  referer?: string
}

export function toOpenRouterApiModelId(modelId: string): string {
  if (!modelId.startsWith('openrouter/')) return modelId
  const rest = modelId.slice('openrouter/'.length)
  return rest.includes('/') ? rest : modelId
}

export class OpenRouterGateway implements LLMGateway {
  constructor(private readonly options: OpenRouterGatewayOptions = {}) {}

  async createLanguageModel(
    modelId: string,
    modelOptions: ModelOptions = {},
  ): Promise<LanguageModel> {
    const apiKey = await resolveProviderApiKey(
      'OpenRouter',
      this.options,
      modelOptions,
      'OPENROUTER_API_KEY',
    )
    const openrouter = createOpenRouter({
      apiKey,
      compatibility: 'strict',
      headers: {
        'HTTP-Referer': this.options.referer ?? 'https://getoverlay.io',
        'X-Title': this.options.appTitle ?? 'Overlay',
        ...this.options.headers,
        ...modelOptions.headers,
      },
      fetch: this.options.fetch,
    })

    return {
      id: modelId,
      provider: 'openrouter',
      implementation: openrouter.chat(toOpenRouterApiModelId(modelId)),
    }
  }

  async listModels(): Promise<ModelInfo[]> {
    return listModelInfo(this.options.models)
  }

  async getModelPricing(modelId: string): Promise<PricingInfo> {
    return pricingFromCatalog(modelId, this.options.models)
  }
}
