import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import type { LanguageModel, LLMGateway, ModelInfo, ModelOptions, PricingInfo } from '../contracts'
import { getByokPreset, type ByokProviderPreset } from './byok-presets'

/**
 * Minimal view of a user provider connection record, as needed by the gateway
 * to construct an AI SDK language model. Kept intentionally decoupled from the
 * Convex schema so the gateway package remains backend-agnostic.
 */
export interface ByokConnection {
  /** Preset id (e.g. `'openrouter'` or `'groq'`). */
  providerId: string
  /** Resolved base URL for the provider's OpenAI-compatible API. */
  endpoint: string
}

/**
 * Resolved API key for a BYOK connection. Managed Overlay-hosted gateway keys
 * are not passed through this BYOK adapter.
 */
export interface ByokGatewayOptions {
  connection: ByokConnection
  apiKey: string | null
  /** Optional custom fetch (e.g. for retry/diagnostics wrappers). */
  fetch?: typeof fetch
}

/**
 * Gateway adapter for user-connected BYOK providers. Each instance is
 * constructed per request with the user's connection config and resolved API
 * key, then creates an OpenAI-compatible AI SDK provider to serve
 * {@link createLanguageModel} calls.
 *
 * Model IDs passed to {@link createLanguageModel} are the raw provider model
 * IDs (e.g. `'llama-3.3-70b-versatile'`) — the `byok/{connectionId}/` prefix
 * is stripped by the caller before reaching the gateway.
 *
 * {@link listModels} and {@link getModelPricing} are not supported here —
 * model discovery happens via the connection-test endpoint and pricing is not
 * tracked for BYOK models (the user pays the provider directly).
 */
export class ByokGateway implements LLMGateway {
  private readonly preset: ByokProviderPreset

  constructor(private readonly options: ByokGatewayOptions) {
    const preset = getByokPreset(options.connection.providerId)
    if (!preset) {
      throw new Error(`Unknown BYOK provider preset: ${options.connection.providerId}.`)
    }
    const endpoint = options.connection.endpoint.trim().replace(/\/+$/, '')
    const presetEndpoint = preset.defaultBaseURL.trim().replace(/\/+$/, '')
    if (!preset.allowsCustomEndpoint && endpoint !== presetEndpoint) {
      throw new Error(`${preset.label} must use its locked provider endpoint.`)
    }
    if (preset.allowsCustomEndpoint && !endpoint) {
      throw new Error(`${preset.label} requires an API base URL.`)
    }
    if (preset.allowsCustomEndpoint && !options.fetch) {
      throw new Error(`${preset.label} requires a guarded fetch implementation.`)
    }
    if (preset.requiresApiKey && !options.apiKey) {
      throw new Error(
        `${preset.label} requires an API key but none was provided.`,
      )
    }
    this.preset = preset
  }

  async createLanguageModel(
    modelId: string,
    _modelOptions: ModelOptions = {},
  ): Promise<LanguageModel> {
    void _modelOptions
    const provider = createOpenAICompatible({
      name: this.options.connection.providerId,
      baseURL: this.options.connection.endpoint,
      ...(this.options.apiKey ? { apiKey: this.options.apiKey } : {}),
      // Do not merge caller-supplied headers here. In openai-compatible,
      // explicit headers override the generated Authorization header; allowing
      // that would let a future caller replace the user-owned Vault key.
      headers: this.preset.headers,
      ...(this.options.fetch ? { fetch: this.options.fetch } : {}),
    })

    return {
      id: modelId,
      provider: this.options.connection.providerId,
      implementation: provider(modelId),
    }
  }

  async listModels(): Promise<ModelInfo[]> {
    // Model discovery is handled by the connection-test endpoint, not by the
    // gateway at runtime. Return an empty list to satisfy the contract.
    return []
  }

  async getModelPricing(_modelId: string): Promise<PricingInfo> {
    // BYOK models bypass Overlay billing — the user pays the provider directly.
    return {
      modelId: _modelId,
      pricingSource: 'byok',
      pricingType: 'language',
      isFree: false,
    }
  }
}
