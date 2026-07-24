export interface ModelOptions {
  accessToken?: string
  apiKey?: string
  provider?: string
  headers?: Record<string, string>
  metadata?: Record<string, unknown>
}

export interface LanguageModel<TImplementation = unknown> {
  id: string
  provider?: string
  implementation: TImplementation
}

export interface ModelInfo {
  id: string
  name: string
  provider: string
  description?: string
  supportsVision?: boolean
  supportsReasoning?: boolean
  supportsSearch?: boolean
  supportsZeroDataRetention?: boolean
  pricePer1mTokens?: number
}

export interface PricingInfo {
  modelId: string
  providerCostUsd?: number
  pricingModelId?: string
  pricingSource?: string
  pricingType?: string
  isFree?: boolean
}

export interface LLMGateway {
  createLanguageModel(modelId: string, options?: ModelOptions): Promise<LanguageModel>
  listModels(): Promise<ModelInfo[]>
  getModelPricing(modelId: string): Promise<PricingInfo>
}

export type ApiKeyResolver = (
  options: ModelOptions,
) => string | null | undefined | Promise<string | null | undefined>
