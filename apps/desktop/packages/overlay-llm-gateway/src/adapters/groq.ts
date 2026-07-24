import { createGroq } from '@ai-sdk/groq'
import type { LanguageModel, LLMGateway, ModelInfo, ModelOptions, PricingInfo } from '../contracts'
import { getModelForId, listModelInfo } from '../models'
import { pricingFromCatalog, resolveProviderApiKey, type ProviderGatewayOptions } from './common'

export function toGroqApiModelId(modelId: string): string {
  return modelId.startsWith('groq/') ? modelId.slice('groq/'.length) : modelId
}

export class GroqGateway implements LLMGateway {
  constructor(private readonly options: ProviderGatewayOptions = {}) {}

  async createLanguageModel(
    modelId: string,
    modelOptions: ModelOptions = {},
  ): Promise<LanguageModel> {
    const apiKey = await resolveProviderApiKey('Groq', this.options, modelOptions, 'GROQ_API_KEY')
    const groq = createGroq({
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
      provider: getModelForId(modelId, this.options.models)?.provider ?? 'groq',
      implementation: groq(toGroqApiModelId(modelId)),
    }
  }

  async listModels(): Promise<ModelInfo[]> {
    return listModelInfo(this.options.models).filter((model) => model.provider === 'groq')
  }

  async getModelPricing(modelId: string): Promise<PricingInfo> {
    return pricingFromCatalog(modelId, this.options.models)
  }
}
