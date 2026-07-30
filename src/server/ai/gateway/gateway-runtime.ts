import 'server-only'

import { createGateway } from 'ai'
import { getModel } from '@/shared/ai/gateway/model-data'
import { getServerProviderKey } from '@/server/ai/gateway/server-provider-keys'

let cachedGateway: ReturnType<typeof createGateway> | null = null
let cachedApiKey: string | null = null

const GATEWAY_MODEL_ID_ALIASES: Record<string, string> = {
  'claude-opus-4-6': 'anthropic/claude-opus-4.7',
  'claude-sonnet-4-6': 'anthropic/claude-sonnet-4.6',
  'claude-haiku-4-5': 'anthropic/claude-haiku-4.5',
  'gemini-3-flash-preview': 'google/gemini-3-flash',
  'gpt-4.1-2025-04-14': 'openai/gpt-4.1',
  'qwen/qwen3.6-plus': 'alibaba/qwen3.6-plus',
  'z-ai/glm-5.1': 'zai/glm-5.1',
}

export async function resolveGatewayApiKey(accessToken?: string): Promise<string | null> {
  void accessToken
  return await getServerProviderKey('ai_gateway')
}

export async function resolveOpenRouterApiKey(accessToken?: string): Promise<string | null> {
  void accessToken
  return await getServerProviderKey('openrouter')
}

export function getGatewayModelId(modelId: string): string {
  const alias = GATEWAY_MODEL_ID_ALIASES[modelId]
  if (alias) return alias

  const model = getModel(modelId)
  if (!model) {
    if (/^[A-Za-z0-9._-]+\/[A-Za-z0-9._:@+-]+$/.test(modelId)) return modelId
    throw new Error(`Unknown model: ${modelId}`)
  }

  const modelAlias = GATEWAY_MODEL_ID_ALIASES[model.id]
  if (modelAlias) return modelAlias

  if (model.id.includes('/')) {
    return model.id
  }

  return `${model.provider}/${model.id}`
}

export async function getOrCreateGateway(
  accessToken?: string,
): Promise<ReturnType<typeof createGateway>> {
  const apiKey = await resolveGatewayApiKey(accessToken)
  if (!apiKey) {
    throw new Error(
      'AI_GATEWAY_API_KEY is not configured. Set it in Convex or the server environment.'
    )
  }
  if (!cachedGateway || cachedApiKey !== apiKey) {
    cachedGateway = createGateway({ apiKey })
    cachedApiKey = apiKey
  }
  return cachedGateway
}

const DEFAULT_GATEWAY_TOOL_PROXY_MODEL_ID = 'deepseek/deepseek-v4-flash'

export function resolveGatewayProviderToolProxyModelId(chatModelId?: string): string {
  if (!chatModelId) return DEFAULT_GATEWAY_TOOL_PROXY_MODEL_ID
  const model = getModel(chatModelId)
  if (!model) return DEFAULT_GATEWAY_TOOL_PROXY_MODEL_ID
  if (['openrouter', 'nvidia'].includes(model.provider)) {
    return DEFAULT_GATEWAY_TOOL_PROXY_MODEL_ID
  }
  return getGatewayModelId(chatModelId)
}
