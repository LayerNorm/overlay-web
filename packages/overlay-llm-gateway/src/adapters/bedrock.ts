import { createAmazonBedrock, type AmazonBedrockProviderSettings } from '@ai-sdk/amazon-bedrock'
import type { LanguageModel, LLMGateway, ModelInfo, ModelOptions, PricingInfo } from '../contracts'
import { getModelForId, listModelInfo } from '../models'
import { pricingFromCatalog, type ProviderGatewayOptions } from './common'

type BedrockCredentialProvider = NonNullable<AmazonBedrockProviderSettings['credentialProvider']>

export interface BedrockGatewayOptions extends ProviderGatewayOptions {
  region?: string
  modelIds?: Readonly<Record<string, string>>
  credentialProvider?: BedrockCredentialProvider
}

export class BedrockGateway implements LLMGateway {
  constructor(private readonly options: BedrockGatewayOptions = {}) {}

  async createLanguageModel(
    modelId: string,
    modelOptions: ModelOptions = {},
  ): Promise<LanguageModel> {
    const mappedModelId = this.options.modelIds?.[modelId]
    if (!mappedModelId && getModelForId(modelId)) {
      throw new Error(`No Bedrock model ID is mapped for ${modelId}. Set llm.bedrock.modelIds (BEDROCK_MODEL_IDS).`)
    }

    const bedrock = createAmazonBedrock({
      region: this.options.region,
      apiKey: modelOptions.apiKey ?? this.options.apiKey,
      credentialProvider: this.options.credentialProvider,
      baseURL: this.options.baseURL,
      headers: {
        ...this.options.headers,
        ...modelOptions.headers,
      },
      fetch: this.options.fetch,
    })

    return {
      id: modelId,
      provider: getModelForId(modelId, this.options.models)?.provider ?? 'bedrock',
      implementation: bedrock(mappedModelId ?? modelId),
    }
  }

  async listModels(): Promise<ModelInfo[]> {
    return Object.keys(this.options.modelIds ?? {}).map((id) => {
      const model = getModelForId(id, this.options.models)
      const info = model ? listModelInfo([model])[0] : undefined
      return info ? { ...info, id } : { id, name: id, provider: 'bedrock' }
    })
  }

  async getModelPricing(modelId: string): Promise<PricingInfo> {
    return pricingFromCatalog(modelId, this.options.models)
  }
}
