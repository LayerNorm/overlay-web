import { appJson } from './appApi'

/**
 * Model catalog (`GET /api/v1/model-catalog`) — the authorized gateway model
 * list used by the Models settings section, and the enabled-set math for
 * `AppSettings.enabledChatModelIds`.
 *
 * `DEFAULT_ENABLED_CHAT_MODEL_IDS` mirrors `DEFAULT_CURATED_CHAT_MODEL_IDS` in
 * `src/shared/ai/gateway/model-data.ts` (web `src/shared` is not linked into
 * the mobile bundle). Keep them in sync — the server treats an empty
 * `enabledChatModelIds` as "use the curated default list".
 */

export interface GatewayCatalogModel {
  id: string
  gatewayId: string
  name: string
  type: 'language' | 'image' | 'video' | 'embedding' | 'reranking'
  provider: string
  description?: string
  contextWindow?: number
  maxTokens?: number
  tags: string[]
  pricing: Record<string, unknown>
  inputPricePerMillion?: number
  outputPricePerMillion?: number
}

export const DEFAULT_ENABLED_CHAT_MODEL_IDS: readonly string[] = [
  'gemini-3.1-pro-preview',
  'gemini-3-flash-preview',
  'google/gemma-4-26b-a4b-it',
  'gpt-5.4',
  'openai/gpt-5.4-mini',
  'gpt-4.1-2025-04-14',
  'anthropic/claude-opus-4.7',
  'claude-sonnet-4-6',
  'claude-haiku-4-5',
  'xai/grok-4.20-reasoning',
  'deepseek/deepseek-v4-pro',
  'deepseek/deepseek-v4-flash',
  'minimax/minimax-m2.7',
  'moonshotai/kimi-k3',
  'moonshotai/kimi-k2.6',
  'z-ai/glm-5.1',
  'qwen/qwen3.6-plus',
  'openai/gpt-oss-120b',
  // SPECIAL_CHAT_MODELS
  'openrouter/free',
  'openrouter/nvidia/nemotron-3-super-120b-a12b:free',
  'stepfun-ai/step-3.5-flash',
]

export async function getGatewayModelCatalog(force = false): Promise<GatewayCatalogModel[]> {
  const response = await appJson<{ models: GatewayCatalogModel[] }>('/api/v1/model-catalog', {
    query: force ? { refresh: '1' } : {},
    timeoutMs: 20_000,
  })
  return response.models ?? []
}

/**
 * The effective enabled id set: an explicit list wins; empty means the
 * curated default (same rule as web `getEffectiveSettingsModelIds`).
 */
export function effectiveEnabledModelIds(enabledChatModelIds: readonly string[]): Set<string> {
  return new Set(
    enabledChatModelIds.length > 0 ? enabledChatModelIds : DEFAULT_ENABLED_CHAT_MODEL_IDS,
  )
}
