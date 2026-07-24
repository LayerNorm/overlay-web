import { createAnthropic } from '@ai-sdk/anthropic'
import type { LanguageModel, LLMGateway, ModelInfo, ModelOptions, PricingInfo } from '../contracts'
import { getModelForId, listModelInfo } from '../models'
import { pricingFromCatalog, resolveProviderApiKey, type ProviderGatewayOptions } from './common'

export function toAnthropicApiModelId(modelId: string): string {
  return modelId.startsWith('anthropic/') ? modelId.slice('anthropic/'.length) : modelId
}

export class AnthropicGateway implements LLMGateway {
  constructor(private readonly options: ProviderGatewayOptions = {}) {}

  async createLanguageModel(
    modelId: string,
    modelOptions: ModelOptions = {},
  ): Promise<LanguageModel> {
    const apiKey = await resolveProviderApiKey('Anthropic', this.options, modelOptions, 'ANTHROPIC_API_KEY')
    const anthropic = createAnthropic({
      apiKey,
      baseURL: this.options.baseURL,
      headers: {
        ...this.options.headers,
        ...modelOptions.headers,
      },
      fetch: this.options.fetch,
    })
    return {
      id: modelId,
      provider: getModelForId(modelId, this.options.models)?.provider ?? 'anthropic',
      implementation: anthropic(toAnthropicApiModelId(modelId)),
    }
  }

  async listModels(): Promise<ModelInfo[]> {
    return listModelInfo(this.options.models).filter((model) => model.provider === 'anthropic')
  }

  async getModelPricing(modelId: string): Promise<PricingInfo> {
    return pricingFromCatalog(modelId, this.options.models)
  }
}
