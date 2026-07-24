/**
 * Gateway Provider Service
 *
 * Unified AI Gateway provider for all model access.
 * Uses Vercel AI Gateway as primary, OpenRouter as fallback for free models.
 */

import { createGateway, type GatewayProvider } from '@ai-sdk/gateway'
import { keyCacheService } from '../key-cache-service'

// Note: dotenv is loaded at the start of main/index.ts before any imports
// so process.env.AI_GATEWAY_API_KEY should be available if set in .env

let gatewayInstance: GatewayProvider | null = null

// Free model IDs that should use OpenRouter fallback
const FREE_MODEL_IDS = new Set([
  'openrouter/free'
])
export const OPENROUTER_FREE_ROUTER_MODEL_ID = 'openrouter/free'

/**
 * Model ID mapping from legacy IDs to Gateway format (provider/model-id)
 */
export const MODEL_ID_MAPPING: Record<string, string> = {
  // Anthropic
  'claude-opus-4-6': 'anthropic/claude-opus-4-6',
  'claude-sonnet-4-6': 'anthropic/claude-sonnet-4-6',
  'claude-haiku-4-5': 'anthropic/claude-haiku-4-5',

  // OpenAI
  'gpt-5.2-pro-2025-12-11': 'openai/gpt-5.2-pro-2025-12-11',
  'gpt-5.2-2025-12-11': 'openai/gpt-5.2-2025-12-11',
  'gpt-5.4': 'openai/gpt-5.4',
  'gpt-5-mini-2025-08-07': 'openai/gpt-5-mini-2025-08-07',
  'gpt-5-nano-2025-08-07': 'openai/gpt-5-nano-2025-08-07',
  'gpt-4.1-2025-04-14': 'openai/gpt-4.1-2025-04-14',
  'gpt-4.1-mini-2025-04-14': 'openai/gpt-4.1-mini-2025-04-14',

  // Google
  'gemini-3.1-pro-preview': 'google/gemini-3.1-pro-preview',
  'gemini-3-flash-preview': 'google/gemini-3-flash-preview',
  'gemini-2.5-flash': 'google/gemini-2.5-flash',
  'gemini-2.5-flash-lite': 'google/gemini-2.5-flash-lite',

  // xAI
  'grok-4-1-fast-reasoning': 'xai/grok-4-1-fast-reasoning',
  'grok-4-1-fast-non-reasoning': 'xai/grok-4-1-fast-non-reasoning',

  // Groq
  'llama-3.1-8b-instant': 'groq/llama-3.1-8b-instant',
  'llama-3.3-70b-versatile': 'groq/llama-3.3-70b-versatile',
  'moonshotai/kimi-k2-0905': 'moonshotai/kimi-k2-0905',
  'moonshotai/kimi-k2-instruct-0905': 'moonshotai/kimi-k2-instruct-0905',
  'moonshotai/kimi-k2.6': 'moonshotai/kimi-k2.6',
  'z-ai/glm-5.1': 'z-ai/glm-5.1',
  'zai/glm-5.1': 'zai/glm-5.1',

  // MiniMax
  'MiniMax-M2.5': 'minimax/minimax-m2.5',
  'minimax-m2.5': 'minimax/minimax-m2.5',
  'minimax/minimax-m2.7': 'minimax/minimax-m2.7',

  // DeepSeek / NVIDIA
  'deepseek/deepseek-v4-pro': 'deepseek/deepseek-v4-pro',
  'deepseek/deepseek-v4-flash': 'deepseek/deepseek-v4-flash',
  'nvidia/nemotron-nano-9b-v2': 'nvidia/nemotron-nano-9b-v2'
}

/**
 * Check if a model ID is a free model that should use OpenRouter
 */
export function isFreeModel(modelId: string): boolean {
  const mappedId = mapModelId(modelId)
  return FREE_MODEL_IDS.has(mappedId) || mappedId.endsWith(':free')
}

/**
 * Check if a model should be routed through OpenRouter directly
 */
export function isOpenRouterModel(modelId: string): boolean {
  const mappedId = mapModelId(modelId)
  return (
    FREE_MODEL_IDS.has(mappedId) || mappedId.startsWith('openrouter/') || mappedId.endsWith(':free')
  )
}

/**
 * Resolve app-level OpenRouter aliases to concrete OpenRouter model IDs
 */
export function resolveOpenRouterModelId(modelId: string): string {
  const mappedId = mapModelId(modelId)
  return mappedId
}

/**
 * Map legacy model ID to Gateway format
 */
export function mapModelId(modelId: string): string {
  // If already in provider/model format, return as-is
  if (modelId.includes('/')) {
    return modelId
  }
  // Check mapping
  return MODEL_ID_MAPPING[modelId] || modelId
}

/**
 * Get the AI Gateway instance
 */
export async function getGateway(): Promise<GatewayProvider> {
  if (gatewayInstance) {
    return gatewayInstance
  }

  // Always fetch from Convex/WorkOS Vault - never from .env
  console.log('[GatewayProvider] Fetching AI_GATEWAY_API_KEY from Convex/WorkOS Vault...')
  let apiKey: string | undefined
  try {
    apiKey = (await keyCacheService.getKey('ai_gateway')) ?? undefined
    if (apiKey) {
      console.log('[GatewayProvider] Got AI_GATEWAY_API_KEY from backend')
    } else {
      console.log('[GatewayProvider] Backend returned null for ai_gateway key')
    }
  } catch (err) {
    console.error('[GatewayProvider] Failed to fetch from backend:', err)
  }

  if (!apiKey) {
    throw new Error(
      'AI Gateway API key not configured. Please sign in and ensure AI_GATEWAY_API_KEY is set in Convex dashboard.'
    )
  }

  gatewayInstance = createGateway({
    apiKey
  })

  console.log('[GatewayProvider] AI Gateway initialized')
  return gatewayInstance
}

/**
 * Get OpenRouter API key for free models
 * Free models use direct fetch to OpenRouter API (via openrouter-chat-service)
 */
export async function getOpenRouterApiKey(): Promise<string> {
  const apiKey = await keyCacheService.getKey('openrouter')
  if (!apiKey) {
    throw new Error('OpenRouter API key not configured for free model fallback.')
  }
  return apiKey
}

/**
 * Get the appropriate model for a given model ID
 * Returns Gateway model string for paid models, OpenRouter provider for free models
 */
export async function getModel(modelId: string): Promise<string> {
  const mappedId = mapModelId(modelId)

  if (isFreeModel(mappedId)) {
    // For free models, we'll use OpenRouter directly
    // The caller should use getOpenRouter() and create the model
    console.log(`[GatewayProvider] Using OpenRouter for free model: ${mappedId}`)
    return mappedId
  }

  // For paid models, ensure Gateway is initialized and return the model ID
  await getGateway()
  console.log(`[GatewayProvider] Using Gateway for model: ${mappedId}`)
  return mappedId
}

/**
 * Get model info for use with AI SDK
 * Returns model ID string and whether it's a free model
 */
export async function getModelInfo(modelId: string): Promise<{ modelId: string; isFree: boolean }> {
  const mappedId = mapModelId(modelId)

  if (isFreeModel(mappedId)) {
    // Free models use OpenRouter via openrouter-chat-service
    return {
      modelId: mappedId,
      isFree: true
    }
  }

  // For Gateway, ensure initialized and return the model ID
  await getGateway()
  return {
    modelId: mappedId,
    isFree: false
  }
}

/**
 * Reset provider instances (useful for testing or re-auth)
 */
export function resetProviders(): void {
  gatewayInstance = null
  console.log('[GatewayProvider] Gateway instance reset')
}

/**
 * Helper to get API key from Convex/WorkOS Vault (never from .env)
 */
async function getApiKey(): Promise<string> {
  const apiKey = await keyCacheService.getKey('ai_gateway')
  if (!apiKey) {
    throw new Error('AI Gateway API key not configured. Please sign in first.')
  }
  return apiKey
}

/**
 * Check Gateway credits balance
 */
export async function getGatewayCredits(): Promise<{ balance: string; total_used: string }> {
  const apiKey = await getApiKey()

  const response = await fetch('https://ai-gateway.vercel.sh/v1/credits', {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    }
  })

  if (!response.ok) {
    throw new Error(`Failed to fetch Gateway credits: ${response.statusText}`)
  }

  return response.json()
}

/**
 * Get generation details by ID
 */
export async function getGenerationDetails(generationId: string): Promise<{
  id: string
  total_cost: number
  model: string
  tokens_prompt: number
  tokens_completion: number
}> {
  const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null
  const toNumber = (value: unknown): number =>
    typeof value === 'number' && Number.isFinite(value) ? value : 0

  const apiKey = await getApiKey()
  const url = new URL('https://ai-gateway.vercel.sh/v1/generation')
  url.searchParams.set('id', generationId)

  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    }
  })

  const responseText = await response.text()

  if (!response.ok) {
    const snippet = responseText ? ` - ${responseText.slice(0, 500)}` : ''
    throw new Error(
      `Failed to fetch generation details (${response.status} ${response.statusText}) for ${generationId}${snippet}`
    )
  }

  let parsed: unknown = null
  if (responseText) {
    try {
      parsed = JSON.parse(responseText)
    } catch {
      throw new Error(`Failed to parse generation details response for ${generationId}`)
    }
  }

  const container = isRecord(parsed) ? parsed : {}
  const payload = isRecord(container.data) ? container.data : container

  return {
    id: typeof payload.id === 'string' ? payload.id : generationId,
    total_cost: toNumber(payload.total_cost),
    model: typeof payload.model === 'string' ? payload.model : '',
    tokens_prompt: toNumber(payload.tokens_prompt),
    tokens_completion: toNumber(payload.tokens_completion)
  }
}
