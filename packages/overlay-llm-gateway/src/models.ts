import type { ModelInfo } from './contracts'

export type ModelCostTier = 0 | 1 | 2 | 3
export type ModelSpeedTier = 1 | 2 | 3

export interface OverlayModelInfo extends ModelInfo {
  intelligence: number
  cost: ModelCostTier
  speedTier: ModelSpeedTier
  supportsVision: boolean
  supportsReasoning: boolean
  supportsSearch: boolean
  supportsZeroDataRetention: boolean
  medianOutputTokensPerSecond?: number
}

export const FREE_TIER_AUTO_MODEL_ID = 'openrouter/free'
export const DEFAULT_MODEL_ID = 'claude-sonnet-4-6'

type MinimalModelDefinition = readonly [
  id: string,
  name: string,
  provider: string,
  supportsVision?: boolean,
  supportsReasoning?: boolean,
]

// Runtime Gateway metadata and pricing come from /v1/models. These definitions only
// keep direct-provider adapters usable before a Gateway catalog has been loaded.
const MODEL_DEFINITIONS: readonly MinimalModelDefinition[] = [
  ['gemini-3.1-pro-preview', 'Gemini 3.1 Pro', 'google', true, true],
  ['gemini-3-flash-preview', 'Gemini 3 Flash', 'google', true, true],
  ['google/gemma-4-26b-a4b-it', 'Gemma 4 26B A4B', 'google', true, true],
  ['gpt-5.4', 'GPT-5.4', 'openai', true, true],
  ['openai/gpt-5.4-mini', 'GPT-5.4 Mini', 'openai', true, true],
  ['gpt-4.1-2025-04-14', 'GPT-4.1', 'openai', true, true],
  ['anthropic/claude-opus-4.7', 'Claude Opus 4.7', 'anthropic', true, true],
  ['claude-sonnet-4-6', 'Claude Sonnet 4.6', 'anthropic', true, true],
  ['claude-haiku-4-5', 'Claude Haiku 4.5', 'anthropic', true, true],
  ['xai/grok-4.20-reasoning', 'Grok 4.20', 'xai', true, true],
  ['deepseek/deepseek-v4-pro', 'DeepSeek V4 Pro', 'deepseek', false, true],
  ['deepseek/deepseek-v4-flash', 'DeepSeek V4 Flash', 'deepseek', false, true],
  ['minimax/minimax-m2.7', 'MiniMax M2.7', 'minimax', false, true],
  ['moonshotai/kimi-k3', 'Kimi K3', 'moonshotai', true, true],
  ['moonshotai/kimi-k2.6', 'Kimi K2.6', 'moonshotai', true, true],
  ['z-ai/glm-5.1', 'GLM 5.1', 'zai', false, true],
  ['qwen/qwen3.6-plus', 'Qwen 3.6 Plus', 'alibaba', false, true],
  ['openai/gpt-oss-120b', 'GPT OSS 120B', 'groq', false, true],
  ['nvidia/nemotron-nano-9b-v2', 'Nemotron Nano 9B', 'nvidia'],
  [FREE_TIER_AUTO_MODEL_ID, 'Free Router', 'openrouter', true, true],
  ['openrouter/nvidia/nemotron-3-super-120b-a12b:free', 'Free: Nemotron 3 Super 120B', 'openrouter', false, true],
  ['stepfun-ai/step-3.5-flash', 'Free: Step 3.5 Flash', 'nvidia', false, true],
]

const FREE_MODEL_IDS = new Set([
  FREE_TIER_AUTO_MODEL_ID,
  'openrouter/nvidia/nemotron-3-super-120b-a12b:free',
  'stepfun-ai/step-3.5-flash',
])

const ZDR_MODEL_IDS = new Set([
  'gemini-3.1-pro-preview',
  'gemini-3-flash-preview',
  'google/gemma-4-26b-a4b-it',
  'anthropic/claude-opus-4.7',
  'claude-sonnet-4-6',
  'claude-haiku-4-5',
  'openai/gpt-oss-120b',
])

export const BUILT_IN_MODELS: OverlayModelInfo[] = MODEL_DEFINITIONS.map(([
  id,
  name,
  provider,
  supportsVision = false,
  supportsReasoning = false,
]) => ({
  id,
  name,
  provider,
  intelligence: 0,
  cost: FREE_MODEL_IDS.has(id) ? 0 : 1,
  speedTier: 2,
  supportsVision,
  supportsReasoning,
  supportsSearch: false,
  supportsZeroDataRetention: ZDR_MODEL_IDS.has(id),
}))

export const MODEL_ID_ALIASES: Record<string, string> = {
  'claude-opus-4-6': 'anthropic/claude-opus-4.7',
  'moonshotai/kimi-k2.5': 'moonshotai/kimi-k2.6',
  'moonshotai/kimi-k2-instruct-0905': 'moonshotai/kimi-k2.6',
  'moonshotai/kimi-k2-0905': 'moonshotai/kimi-k2.6',
  'gpt-5.2-pro-2025-12-11': 'gpt-5.4',
  'gpt-5.2-2025-12-11': 'gpt-5.4',
  'gpt-5-mini-2025-08-07': 'openai/gpt-5.4-mini',
  'gpt-5-nano-2025-08-07': 'openai/gpt-5.4-mini',
  'grok-4-1-fast-reasoning': 'xai/grok-4.20-reasoning',
  'openai/gpt-oss-20b': 'openai/gpt-oss-120b',
  'gemini-2.5-flash': 'gemini-3-flash-preview',
  'gemini-2.5-flash-lite': 'google/gemma-4-26b-a4b-it',
  'zai/glm-5.1': 'z-ai/glm-5.1',
  'alibaba/qwen3.6-plus': 'qwen/qwen3.6-plus',
  'deepseek-ai/deepseek-v3.2': 'stepfun-ai/step-3.5-flash',
  'moonshotai/kimi-k2-thinking': 'stepfun-ai/step-3.5-flash',
  'minimaxai/minimax-m2.7': 'stepfun-ai/step-3.5-flash',
}

export function resolveModelId(modelId: string): string {
  return MODEL_ID_ALIASES[modelId] ?? modelId
}

export function getModelForId(
  modelId: string,
  models: readonly OverlayModelInfo[] = BUILT_IN_MODELS,
): OverlayModelInfo | undefined {
  const resolved = resolveModelId(modelId)
  return models.find((model) => model.id === resolved)
}

export function listModelInfo(
  models: readonly OverlayModelInfo[] = BUILT_IN_MODELS,
): ModelInfo[] {
  return models.map((model) => ({
    id: model.id,
    name: model.name,
    provider: model.provider,
    description: model.description,
    supportsVision: model.supportsVision,
    supportsReasoning: model.supportsReasoning,
    supportsSearch: model.supportsSearch,
    supportsZeroDataRetention: model.supportsZeroDataRetention,
  }))
}
