export type GenerationMode = 'text' | 'image' | 'video'

export type VideoSubMode =
  | 'text-to-video'
  | 'image-to-video'
  | 'reference-to-video'
  | 'motion-control'
  | 'video-editing'

export interface ChatModel {
  id: string
  name: string
  provider: string
  description?: string
  intelligence: number
  /** 0 = free, 1 = cheap, 2 = mid, 3 = expensive */
  cost: 0 | 1 | 2 | 3
  /** Relative latency: 1 = heavier/slower, 3 = faster/lighter (for model picker UI). */
  speedTier: 1 | 2 | 3
  supportsVision: boolean
  supportsReasoning: boolean
  supportsSearch: boolean
  supportsZeroDataRetention: boolean
  /** Price per 1M blended tokens ($). */
  pricePer1mTokens?: number
  /** Median output tokens per second. */
  medianOutputTokensPerSecond?: number
}

export interface ImageModel {
  id: string
  name: string
  provider: string
  description?: string
  defaultAspectRatio?: string
}

export interface VideoModel {
  id: string
  name: string
  provider: string
  description?: string
  billingUnit: 'per_video' | 'per_second'
  defaultDuration?: number
  defaultAspectRatio?: string
  subModes: VideoSubMode[]
}

export const FREE_TIER_AUTO_MODEL_ID = 'openrouter/free'
/** @deprecated Alias for {@link FREE_TIER_AUTO_MODEL_ID}. */
export const FREE_TIER_DEFAULT_MODEL_ID = FREE_TIER_AUTO_MODEL_ID
export const PAID_TIER_DEFAULT_MODEL_ID = 'moonshotai/kimi-k2.6' as const
// Retired free IDs stay here only so saved user preferences migrate to the current default.
export const FREE_TIER_LEGACY_DEFAULT_MODEL_IDS = [
  'openrouter/moonshotai/kimi-k2.6:free',
  'openrouter/z-ai/glm-4.5-air:free',
  'openrouter/inclusionai/ring-2.6-1t:free',
  'openrouter/deepseek/deepseek-v4-flash:free',
  'openrouter/minimax/minimax-m2.5:free',
  'openrouter/arcee-ai/trinity-large-thinking:free',
  'openrouter/openai/gpt-oss-120b:free',
] as const

export const NVIDIA_NIM_MODEL_IDS = [
  'stepfun-ai/step-3.5-flash',
] as const

export const FREE_TIER_OPENROUTER_MODEL_IDS = [
  'openrouter/nvidia/nemotron-3-super-120b-a12b:free',
] as const

export type FreeTierChatModelId =
  | typeof FREE_TIER_AUTO_MODEL_ID
  | (typeof NVIDIA_NIM_MODEL_IDS)[number]
  | (typeof FREE_TIER_OPENROUTER_MODEL_IDS)[number]

export function isNvidiaNimChatModelId(modelId: string): boolean {
  return (NVIDIA_NIM_MODEL_IDS as readonly string[]).includes(modelId)
}

export function isFreeTierOpenRouterChatModelId(modelId: string): boolean {
  return (FREE_TIER_OPENROUTER_MODEL_IDS as readonly string[]).includes(modelId)
}

export function isLegacyFreeTierDefaultModelId(modelId: string | undefined): modelId is string {
  return Boolean(modelId && (FREE_TIER_LEGACY_DEFAULT_MODEL_IDS as readonly string[]).includes(modelId))
}

export function isFreeTierChatModelId(
  modelId: string | undefined,
): modelId is FreeTierChatModelId {
  return Boolean(
    modelId &&
      (modelId === FREE_TIER_AUTO_MODEL_ID ||
        isNvidiaNimChatModelId(modelId) ||
        isFreeTierOpenRouterChatModelId(modelId)),
  )
}

export function resolveFreeTierChatModelId(modelId: string | undefined): string | undefined {
  if (!modelId) return undefined
  if (isLegacyFreeTierDefaultModelId(modelId)) return FREE_TIER_AUTO_MODEL_ID
  return isFreeTierChatModelId(modelId) ? modelId : undefined
}

export const DEFAULT_MODEL_ID = PAID_TIER_DEFAULT_MODEL_ID
export const DEFAULT_IMAGE_MODEL_ID = 'openai/gpt-image-1.5'
export const DEFAULT_VIDEO_MODEL_ID = 'google/veo-3.1-generate-001'
