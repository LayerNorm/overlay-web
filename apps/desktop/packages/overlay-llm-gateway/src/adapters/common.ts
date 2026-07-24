import type { ApiKeyResolver, ModelOptions, PricingInfo } from '../contracts'
import { BUILT_IN_MODELS, getModelForId, type OverlayModelInfo } from '../models'

export interface ProviderGatewayOptions {
  apiKey?: string
  getApiKey?: ApiKeyResolver
  baseURL?: string
  headers?: Record<string, string>
  fetch?: typeof fetch
  models?: readonly OverlayModelInfo[]
}

export async function resolveProviderApiKey(
  provider: string,
  options: ProviderGatewayOptions,
  modelOptions: ModelOptions,
  envVarName: string,
): Promise<string> {
  const explicit = modelOptions.apiKey ?? options.apiKey
  if (explicit) return explicit

  const resolved = await options.getApiKey?.(modelOptions)
  if (resolved) return resolved

  const env = process.env[envVarName]
  if (env) return env

  throw new Error(`${provider} API key is not configured. Pass apiKey/getApiKey or set ${envVarName}.`)
}

export function pricingFromCatalog(
  modelId: string,
  models: readonly OverlayModelInfo[] = BUILT_IN_MODELS,
): PricingInfo {
  const model = getModelForId(modelId, models)
  return {
    modelId,
    pricingModelId: model?.id ?? modelId,
    pricingSource: model ? 'runtime-catalog-required' : undefined,
    pricingType: 'language',
    isFree: model?.cost === 0,
  }
}
