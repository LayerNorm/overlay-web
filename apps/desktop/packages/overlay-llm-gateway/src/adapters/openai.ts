import { createOpenAI } from '@ai-sdk/openai'
import type { LanguageModel, LLMGateway, ModelInfo, ModelOptions, PricingInfo } from '../contracts'
import { getModelForId, listModelInfo } from '../models'
import { pricingFromCatalog, resolveProviderApiKey, type ProviderGatewayOptions } from './common'

export function toOpenAIApiModelId(modelId: string): string {
  return modelId.startsWith('openai/') ? modelId.slice('openai/'.length) : modelId
}

export class DirectOpenAIGateway implements LLMGateway {
  constructor(private readonly options: ProviderGatewayOptions = {}) {}

  async createLanguageModel(
    modelId: string,
    modelOptions: ModelOptions = {},
  ): Promise<LanguageModel> {
    const apiKey = await resolveProviderApiKey('OpenAI', this.options, modelOptions, 'OPENAI_API_KEY')
    const openai = createOpenAI({
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
      provider: getModelForId(modelId, this.options.models)?.provider ?? 'openai',
      implementation: openai(toOpenAIApiModelId(modelId)),
    }
  }

  async listModels(): Promise<ModelInfo[]> {
    return listModelInfo(this.options.models).filter((model) => model.provider === 'openai')
  }

  async getModelPricing(modelId: string): Promise<PricingInfo> {
    return pricingFromCatalog(modelId, this.options.models)
  }
}
