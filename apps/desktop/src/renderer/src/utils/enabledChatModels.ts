/**
 * Enabled-model filtering for chat/notebook dropdowns.
 * Mirrors ModelsSettings + web getEnabledChatModels: when the user has
 * enabledChatModelIds in cloud settings, only those appear in the picker.
 */

import type { ChatModel } from '../components/chat/types'

/** Fallback when enabledChatModelIds is empty — same curated set as web model-data. */
export const CURATED_DEFAULT_CHAT_MODEL_IDS: readonly string[] = [
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
  'openrouter/free',
  'openrouter/nvidia/nemotron-3-super-120b-a12b:free',
  'stepfun-ai/step-3.5-flash',
]

export function resolveEnabledChatModelIds(
  enabledIds: readonly string[] | null | undefined
): string[] {
  return enabledIds && enabledIds.length > 0
    ? [...enabledIds]
    : [...CURATED_DEFAULT_CHAT_MODEL_IDS]
}

function provisionalChatModelFromId(id: string): ChatModel {
  const leaf = id.split('/').pop() ?? id
  const name = leaf
    .replace(/:free$/i, '')
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => {
      if (/^\d/.test(part) || part === part.toUpperCase()) return part
      return part.charAt(0).toUpperCase() + part.slice(1)
    })
    .join(' ')
  const provider = id.includes('/') ? id.slice(0, id.indexOf('/')) : 'unknown'
  const isFree = id === 'openrouter/free' || id.endsWith(':free') || id === 'stepfun-ai/step-3.5-flash'
  return {
    id,
    name: isFree && !name.toLowerCase().startsWith('free') ? `Free: ${name}` : name,
    provider,
    intelligence: 0,
    cost: isFree ? 0 : 1,
    speedTier: 2,
    supportsVision: false,
    supportsReasoning: false,
    supportsSearch: false,
    supportsZeroDataRetention: false
  }
}

/**
 * Keep only models the user enabled in Models settings (synced from cloud).
 * Missing catalog entries get provisional placeholders so the picker never
 * collapses to a handful of built-in IDs while bootstrap/catalog is catching up.
 */
export function filterToEnabledChatModels(
  models: readonly ChatModel[],
  enabledIds: readonly string[] | null | undefined,
  options?: { includeProvisional?: boolean }
): ChatModel[] {
  const enabled = resolveEnabledChatModelIds(enabledIds)
  const byId = new Map(models.map((model) => [model.id, model]))
  const includeProvisional = options?.includeProvisional !== false
  const result: ChatModel[] = []
  for (const id of enabled) {
    const found = byId.get(id)
    if (found) {
      result.push(found)
      continue
    }
    if (includeProvisional) {
      result.push(provisionalChatModelFromId(id))
    }
  }
  return result
}
