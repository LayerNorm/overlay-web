import 'server-only'

import { createOpenRouter } from '@openrouter/ai-sdk-provider'
import {
  getModel,
  registerGatewayCatalogModels,
} from '@/shared/ai/gateway/model-data'
import { calculateGatewayLanguageTokenCostOrNull } from '@/shared/ai/gateway/model-pricing'
import { openRouterFetchWithRetry, toOpenRouterApiModelId } from '@/server/ai/gateway/openrouter-service'
import { getGatewayCatalogModel, getGatewayLanguageCatalog } from './gateway-catalog'
import {
  getGatewayModelId,
  getOrCreateGateway,
  resolveOpenRouterApiKey,
} from './gateway-runtime'
export {
  getGatewayModelId,
  resolveGatewayProviderToolProxyModelId,
} from './gateway-runtime'

import type {
  LanguageModel,
  LLMGateway,
  ModelInfo,
  ModelOptions,
  PricingInfo,
} from '@overlay/llm-gateway'

export async function getOpenRouterLanguageModel(modelId: string, accessToken?: string) {
  const apiKey = await resolveOpenRouterApiKey(accessToken)
  if (!apiKey) {
    throw new Error(
      'OPENROUTER_API_KEY is not configured. Set it in Convex or the server environment.'
    )
  }

  // Official OpenRouter AI SDK provider — chat() uses /v1/chat/completions (tool + stream compatible).
  // See https://openrouter.ai/docs/guides/community/vercel-ai-sdk
  const openrouter = createOpenRouter({
    apiKey,
    compatibility: 'strict',
    headers: {
      'HTTP-Referer': 'https://getoverlay.io',
      'X-Title': 'Overlay',
    },
    fetch: openRouterFetchWithRetry,
  })

  return openrouter.chat(toOpenRouterApiModelId(modelId))
}

/**
 * Like {@link getOpenRouterLanguageModel} but also captures the actual model OpenRouter routes to
 * (for `openrouter/free` the router picks a free model at runtime). The `onModelCaptured` callback
 * is invoked as soon as the first SSE chunk with a `model` field arrives, so it is always set
 * before `ToolLoopAgent.onFinish` is called.
 */
export async function getOpenRouterLanguageModelCapturingRoutedModel(
  modelId: string,
  accessToken: string | undefined,
  onModelCaptured: (model: string) => void,
) {
  const apiKey = await resolveOpenRouterApiKey(accessToken)
  if (!apiKey) {
    throw new Error(
      'OPENROUTER_API_KEY is not configured. Set it in Convex or the server environment.'
    )
  }

  const captureFetch = async (url: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const response = await openRouterFetchWithRetry(url, init)
    if (!response.body) return response
    const [primary, capture] = response.body.tee()
    ;(async () => {
      const reader = capture.getReader()
      const decoder = new TextDecoder()
      let buf = ''
      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          buf += decoder.decode(value, { stream: true })
          const lines = buf.split('\n')
          buf = lines.pop() ?? ''
          let stop = false
          for (const line of lines) {
            if (!line.startsWith('data: ')) continue
            const data = line.slice(6).trim()
            if (data === '[DONE]') { stop = true; break }
            try {
              const chunk = JSON.parse(data) as { model?: string }
              if (typeof chunk.model === 'string' && chunk.model) {
                onModelCaptured(chunk.model)
                stop = true
                break
              }
            } catch (_error) { /* ignore parse errors */ }
          }
          if (stop) break
        }
      } catch (_error) { /* ignore read errors */ } finally {
        reader.cancel().catch((_error) => undefined)
      }
    })()
    return new Response(primary, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    })
  }

  const openrouter = createOpenRouter({
    apiKey,
    compatibility: 'strict',
    headers: {
      'HTTP-Referer': 'https://getoverlay.io',
      'X-Title': 'Overlay',
    },
    fetch: captureFetch,
  })
  return openrouter.chat(toOpenRouterApiModelId(modelId))
}

export async function getGatewayLanguageModel(
  modelId: string,
  accessToken?: string,
) {
  const model = getModel(modelId)

  // Route OpenRouter models to OpenRouter API
  if (model?.provider === 'openrouter') {
    return getOpenRouterLanguageModel(modelId, accessToken)
  }

  const gateway = await getOrCreateGateway(accessToken)
  return gateway(getGatewayModelId(modelId))
}

export async function getGatewayImageModel(modelId: string, accessToken?: string) {
  const gateway = await getOrCreateGateway(accessToken)
  return gateway.image(modelId)
}

export async function getGatewayVideoModel(modelId: string, accessToken?: string) {
  const gateway = await getOrCreateGateway(accessToken)
  return gateway.video(modelId)
}

export interface OpenRouterGatewayConfig {
  gatewayProvider?: 'openrouter' | 'ai-gateway'
  apiKeyEnvVar?: string
  defaultChatModelId?: string
  modelAllowlist?: readonly string[]
}

export class OpenRouterGateway implements LLMGateway {
  readonly providerConfigSummary: {
    provider: 'openrouter' | 'ai-gateway'
    apiKeyEnvVar?: string
    defaultChatModelId?: string
    modelAllowlist: readonly string[]
  }

  constructor(private readonly config: OpenRouterGatewayConfig = {}) {
    this.providerConfigSummary = {
      provider: config.gatewayProvider ?? 'openrouter',
      ...(config.apiKeyEnvVar ? { apiKeyEnvVar: config.apiKeyEnvVar } : {}),
      ...(config.defaultChatModelId ? { defaultChatModelId: config.defaultChatModelId } : {}),
      modelAllowlist: config.modelAllowlist ?? [],
    }
  }

  async createLanguageModel(
    modelId: string,
    options: ModelOptions = {},
  ): Promise<LanguageModel> {
    const model = getModel(modelId)
    const implementation = await getGatewayLanguageModel(modelId, options.accessToken)
    return {
      id: modelId,
      provider: model?.provider,
      implementation,
    }
  }

  async listModels(): Promise<ModelInfo[]> {
    const allowlist = new Set(this.config.modelAllowlist ?? [])
    const catalog = await getGatewayLanguageCatalog()
    registerGatewayCatalogModels(catalog)
    return catalog
      .filter((model) => allowlist.size === 0 || allowlist.has(model.id))
      .map((model) => ({
      id: model.id,
      name: model.name,
      provider: model.provider,
      description: model.description,
      supportsVision: model.tags.includes('vision'),
      supportsReasoning: model.tags.includes('reasoning'),
      supportsSearch: model.tags.includes('web-search'),
      pricePer1mTokens:
        ((model.inputPricePerMillion ?? 0) + (model.outputPricePerMillion ?? 0)) / 2,
    }))
  }

  async getModelPricing(modelId: string): Promise<PricingInfo> {
    const model = await getGatewayCatalogModel(modelId)
    const providerCostUsd = model?.type === 'language'
      ? calculateGatewayLanguageTokenCostOrNull(model.pricing, 1_000_000, 0, 0) ?? undefined
      : undefined
    return {
      modelId,
      providerCostUsd,
      pricingModelId: model?.gatewayId ?? modelId,
      pricingSource: model ? 'gateway-api' : undefined,
      pricingType: 'language',
      isFree: providerCostUsd === 0,
    }
  }
}
