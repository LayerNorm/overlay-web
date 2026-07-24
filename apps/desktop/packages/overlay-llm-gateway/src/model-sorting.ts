import { FREE_TIER_AUTO_MODEL_ID } from './models'

/**
 * Highest quality first — used when picking a default Act model from a
 * multi-model selection and when sorting the model picker by intelligence.
 * Kept in sync with the web app's `src/shared/ai/gateway/model-data.ts`.
 */
export const CHAT_MODEL_QUALITY_PRIORITY: readonly string[] = [
  'anthropic/claude-opus-4.7',
  'gemini-3.1-pro-preview',
  'gpt-5.4',
  'claude-sonnet-4-6',
  'xai/grok-4.20-reasoning',
  'deepseek/deepseek-v4-pro',
  'deepseek/deepseek-v4-flash',
  'moonshotai/kimi-k3',
  'moonshotai/kimi-k2.6',
  'qwen/qwen3.6-plus',
  'gemini-3-flash-preview',
  'openai/gpt-5.4-mini',
  'z-ai/glm-5.1',
  'gpt-4.1-2025-04-14',
  'claude-haiku-4-5',
  'google/gemma-4-26b-a4b-it',
  'openai/gpt-oss-120b',
  'nvidia/nemotron-nano-9b-v2',
  'minimax/minimax-m2.7',
  'stepfun-ai/step-3.5-flash',
  'openrouter/nvidia/nemotron-3-super-120b-a12b:free',
  FREE_TIER_AUTO_MODEL_ID,
]

/** True for the free-tier router ("Auto") and OpenRouter/NVIDIA NIM free models. */
export function isFreeTierModel(modelId: string | undefined): modelId is string {
  if (!modelId) return false
  if (modelId === FREE_TIER_AUTO_MODEL_ID) return true
  if (modelId.endsWith(':free')) return true
  return modelId === 'stepfun-ai/step-3.5-flash'
}

/**
 * Models sorted by intelligence (CHAT_MODEL_QUALITY_PRIORITY order).
 * Free-tier users: free models first (Auto on top), then premium.
 * Paid users: premium first, free section last — so the picker FREE divider
 * never traps unknown/gateway premium models (priority index 999) underneath it.
 *
 * Generic over the model shape so it accepts both `OverlayModelInfo[]`
 * (shared catalog) and `ChatModel[]` (app-core contract with optional fields).
 */
export function getModelsByIntelligence<T extends { id: string }>(
  models: readonly T[],
  isFreeTier: boolean,
): T[] {
  const idxMap = new Map(CHAT_MODEL_QUALITY_PRIORITY.map((id, i) => [id, i]))
  const sorted = [...models].sort(
    (a, b) => (idxMap.get(a.id) ?? 999) - (idxMap.get(b.id) ?? 999),
  )
  const free = sorted.filter((m) => isFreeTierModel(m.id))
  const premium = sorted.filter((m) => !isFreeTierModel(m.id))
  const freeAuto = free.filter((m) => m.id === FREE_TIER_AUTO_MODEL_ID)
  const explicitFree = free.filter((m) => m.id !== FREE_TIER_AUTO_MODEL_ID)
  if (isFreeTier) {
    return [...freeAuto, ...explicitFree, ...premium]
  }
  return [...premium, ...freeAuto, ...explicitFree]
}

/** Pick the highest-quality model from a multi-model selection. */
export function pickBestModelForAct(selectedModelIds: readonly string[]): string | undefined {
  if (selectedModelIds.length === 1) return selectedModelIds[0]
  const sel = new Set(selectedModelIds)
  for (const id of CHAT_MODEL_QUALITY_PRIORITY) {
    if (sel.has(id)) return id
  }
  return selectedModelIds[0]
}
