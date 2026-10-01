import { createAzure } from '@ai-sdk/azure'
import type { LanguageModel, LLMGateway, ModelInfo, ModelOptions, PricingInfo } from '../contracts'
import { getModelForId, listModelInfo } from '../models'
import { pricingFromCatalog, resolveProviderApiKey, type ProviderGatewayOptions } from './common'
import { toOpenAIApiModelId } from './openai'

export interface AzureOpenAIGatewayOptions extends ProviderGatewayOptions {
  resourceName?: string
  apiVersion?: string
  deployments?: Readonly<Record<string, string>>
}

export class AzureOpenAIGateway implements LLMGateway {
  constructor(private readonly options: AzureOpenAIGatewayOptions = {}) {}

  async createLanguageModel(
    modelId: string,
    modelOptions: ModelOptions = {},
  ): Promise<LanguageModel> {
    const apiKey = await resolveProviderApiKey('Azure OpenAI', this.options, modelOptions, 'AZURE_OPENAI_API_KEY')
    const azure = createAzure({
      apiKey,
      resourceName: this.options.resourceName,
      baseURL: this.options.baseURL,
      apiVersion: this.options.apiVersion,
      headers: {
        ...this.options.headers,
        ...modelOptions.headers,
      },
      fetch: this.options.fetch,
    })
    const deployment = this.options.deployments?.[modelId] ?? toOpenAIApiModelId(modelId)

    return {
      id: modelId,
      provider: getModelForId(modelId, this.options.models)?.provider ?? 'openai',
      implementation: azure(deployment),
    }
  }

  async listModels(): Promise<ModelInfo[]> {
    const deployments = Object.keys(this.options.deployments ?? {})
    if (deployments.length > 0) {
      return deployments.map((id) => {
        const model = getModelForId(id, this.options.models)
        const info = model ? listModelInfo([model])[0] : undefined
        return info ? { ...info, id } : { id, name: id, provider: 'openai' }
      })
    }
    return listModelInfo(this.options.models).filter((model) => model.provider === 'openai')
  }

  async getModelPricing(modelId: string): Promise<PricingInfo> {
    return pricingFromCatalog(modelId, this.options.models)
  }
}
