export type GenerationMode = 'text' | 'image' | 'video'

export type ModelReasoningLevel = 'provider-default' | 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'

export interface ModelReasoningOption {
  value: ModelReasoningLevel
  label: string
}

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
  sourceLabel?: string
  connectionName?: string
  intelligence: number
  /** 0 = zero-priced, 1 = cheap, 2 = mid, 3 = expensive */
  cost: 0 | 1 | 2 | 3
  /** Relative latency: 1 = heavier/slower, 3 = faster/lighter (for model picker UI). */
  speedTier: 1 | 2 | 3
  supportsVision: boolean
  supportsReasoning: boolean
  /** Explicit effort levels supported by this model. Unknown models expose only provider-default. */
  reasoningLevels?: readonly ModelReasoningOption[]
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

const RETIRED_HOSTED_MODEL_IDS = new Set([
  'overlay-free',
  'openrouter/free',
  'stepfun-ai/step-3.5-flash',
  'deepseek-ai/deepseek-v3.2',
  'moonshotai/kimi-k2-thinking',
  'minimaxai/minimax-m2.7',
])

export function isRetiredHostedModelId(modelId: string | undefined): boolean {
  if (!modelId || modelId.startsWith('byok/')) return false
  return RETIRED_HOSTED_MODEL_IDS.has(modelId) || modelId.endsWith(':free')
}

export const DEFAULT_MODEL_ID = 'deepseek/deepseek-v4-flash-0731' as const
export const KIMI_K3_MODEL_ID = 'moonshotai/kimi-k3' as const

export function isKimiK3ModelId(modelId: string | undefined): boolean {
  return modelId === KIMI_K3_MODEL_ID
}

/** New agents start on GLM 5.3 Flash (gateway id `zai/glm-5.3-flash`). */
export const NEW_AGENT_DEFAULT_MODEL_ID = 'z-ai/glm-5.3-flash' as const
export const DEFAULT_IMAGE_MODEL_ID = 'openai/gpt-image-1.5'
export const DEFAULT_VIDEO_MODEL_ID = 'google/veo-3.1-generate-001'
