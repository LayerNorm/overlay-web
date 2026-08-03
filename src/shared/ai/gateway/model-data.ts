import type { ChatModel, ImageModel, VideoModel, VideoSubMode } from '@/shared/ai/gateway/model-types'
import {
  FREE_TIER_AUTO_MODEL_ID,
  FREE_TIER_DEFAULT_MODEL_ID,
  DEFAULT_MODEL_ID,
  isFreeTierChatModelId,
} from '@/shared/ai/gateway/model-types'
import {
  gatewayCatalogModelToChatModel,
  type GatewayCatalogModel,
} from '@/shared/ai/gateway/gateway-catalog'
import {
  byokConnectionsToChatModels,
  isByokModelId,
  type ByokConnectionRow,
} from '@/shared/ai/gateway/byok-model-conversion'

const SPECIAL_CHAT_MODELS: ChatModel[] = [
  { id: FREE_TIER_AUTO_MODEL_ID, name: 'Free Router', provider: 'openrouter', description: 'Auto-selects a free model', intelligence: 0, cost: 0, speedTier: 2, supportsVision: true, supportsReasoning: true, supportsSearch: false, supportsZeroDataRetention: false, pricePer1mTokens: 0 },
  { id: 'openrouter/nvidia/nemotron-3-super-120b-a12b:free', name: 'Free: Nemotron 3 Super 120B', provider: 'openrouter', intelligence: 0, cost: 0, speedTier: 2, supportsVision: false, supportsReasoning: true, supportsSearch: false, supportsZeroDataRetention: false, pricePer1mTokens: 0 },
  { id: 'stepfun-ai/step-3.5-flash', name: 'Free: Step 3.5 Flash', provider: 'nvidia', intelligence: 0, cost: 0, speedTier: 2, supportsVision: false, supportsReasoning: true, supportsSearch: false, supportsZeroDataRetention: false, pricePer1mTokens: 0 },
]

export const OVERLAY_FREE_CHAT_MODELS: readonly ChatModel[] = SPECIAL_CHAT_MODELS

const CURATED_FALLBACK_CHAT_MODELS: ChatModel[] = [
  { id: 'gemini-3.1-pro-preview', name: 'Gemini 3.1 Pro Preview', provider: 'google', intelligence: 0, cost: 3, speedTier: 1, supportsVision: true, supportsReasoning: true, supportsSearch: false, supportsZeroDataRetention: true },
  { id: 'gemini-3-flash-preview', name: 'Gemini 3 Flash Preview', provider: 'google', intelligence: 0, cost: 1, speedTier: 3, supportsVision: true, supportsReasoning: true, supportsSearch: false, supportsZeroDataRetention: true },
  { id: 'google/gemma-4-26b-a4b-it', name: 'Gemma 4 26B', provider: 'google', intelligence: 0, cost: 1, speedTier: 3, supportsVision: false, supportsReasoning: false, supportsSearch: false, supportsZeroDataRetention: true },
  { id: 'gpt-5.4', name: 'GPT-5.4', provider: 'openai', intelligence: 0, cost: 3, speedTier: 1, supportsVision: true, supportsReasoning: true, supportsSearch: false, supportsZeroDataRetention: false },
  { id: 'openai/gpt-5.4-mini', name: 'GPT-5.4 Mini', provider: 'openai', intelligence: 0, cost: 1, speedTier: 3, supportsVision: true, supportsReasoning: true, supportsSearch: false, supportsZeroDataRetention: false },
  { id: 'gpt-4.1-2025-04-14', name: 'GPT-4.1', provider: 'openai', intelligence: 0, cost: 2, speedTier: 2, supportsVision: true, supportsReasoning: false, supportsSearch: false, supportsZeroDataRetention: false },
  { id: 'anthropic/claude-opus-4.7', name: 'Claude Opus 4.7', provider: 'anthropic', intelligence: 0, cost: 3, speedTier: 1, supportsVision: true, supportsReasoning: true, supportsSearch: false, supportsZeroDataRetention: true },
  { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6', provider: 'anthropic', intelligence: 0, cost: 2, speedTier: 2, supportsVision: true, supportsReasoning: true, supportsSearch: false, supportsZeroDataRetention: true },
  { id: 'claude-haiku-4-5', name: 'Claude Haiku 4.5', provider: 'anthropic', intelligence: 0, cost: 1, speedTier: 3, supportsVision: true, supportsReasoning: false, supportsSearch: false, supportsZeroDataRetention: true },
  { id: 'xai/grok-4.20-reasoning', name: 'Grok 4.20 Reasoning', provider: 'xai', intelligence: 0, cost: 3, speedTier: 1, supportsVision: true, supportsReasoning: true, supportsSearch: false, supportsZeroDataRetention: false },
  { id: 'deepseek/deepseek-v4-pro', name: 'DeepSeek V4 Pro', provider: 'deepseek', intelligence: 0, cost: 2, speedTier: 2, supportsVision: false, supportsReasoning: true, supportsSearch: false, supportsZeroDataRetention: false },
  { id: 'deepseek/deepseek-v4-flash', name: 'DeepSeek V4 Flash', provider: 'deepseek', intelligence: 0, cost: 1, speedTier: 3, supportsVision: false, supportsReasoning: true, supportsSearch: false, supportsZeroDataRetention: false },
  { id: 'minimax/minimax-m2.7', name: 'MiniMax M2.7', provider: 'minimax', intelligence: 0, cost: 1, speedTier: 2, supportsVision: false, supportsReasoning: true, supportsSearch: false, supportsZeroDataRetention: false },
  { id: 'moonshotai/kimi-k3', name: 'Kimi K3', provider: 'moonshotai', intelligence: 0, cost: 3, speedTier: 1, supportsVision: true, supportsReasoning: true, supportsSearch: false, supportsZeroDataRetention: false },
  { id: 'moonshotai/kimi-k2.6', name: 'Kimi K2.6', provider: 'moonshotai', intelligence: 0, cost: 1, speedTier: 2, supportsVision: false, supportsReasoning: true, supportsSearch: false, supportsZeroDataRetention: false },
  { id: 'z-ai/glm-5.1', name: 'GLM 5.1', provider: 'z-ai', intelligence: 0, cost: 1, speedTier: 2, supportsVision: false, supportsReasoning: true, supportsSearch: false, supportsZeroDataRetention: false },
  { id: 'qwen/qwen3.6-plus', name: 'Qwen3.6 Plus', provider: 'qwen', intelligence: 0, cost: 1, speedTier: 2, supportsVision: false, supportsReasoning: true, supportsSearch: false, supportsZeroDataRetention: false },
  { id: 'openai/gpt-oss-120b', name: 'GPT OSS 120B', provider: 'openai', intelligence: 0, cost: 1, speedTier: 2, supportsVision: false, supportsReasoning: true, supportsSearch: false, supportsZeroDataRetention: true },
]

export const DEFAULT_CURATED_CHAT_MODEL_IDS = [
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
  ...SPECIAL_CHAT_MODELS.map((model) => model.id),
] as const

export const AVAILABLE_MODELS: ChatModel[] = [...CURATED_FALLBACK_CHAT_MODELS, ...SPECIAL_CHAT_MODELS]

const gatewayCatalogModels = new Map<string, ChatModel>()
const byokModels = new Map<string, ChatModel>()
/** Bumps whenever the gateway catalog is registered so React can re-render pickers. */
let gatewayCatalogRevision = 0
let gatewayCatalogRegistered = false
const ZDR_MODEL_IDS = new Set([
  'gemini-3.1-pro-preview',
  'gemini-3-flash-preview',
  'google/gemma-4-26b-a4b-it',
  'anthropic/claude-opus-4.7',
  'claude-sonnet-4-6',
  'claude-haiku-4-5',
  'openai/gpt-oss-120b',
])

export function getGatewayCatalogRevision(): number {
  return gatewayCatalogRevision
}

export function isGatewayCatalogRegistered(): boolean {
  return gatewayCatalogRegistered
}

export function registerGatewayCatalogModels(models: readonly GatewayCatalogModel[]): void {
  const registered: ChatModel[] = []
  const registeredIds = new Set<string>()
  for (const model of models) {
    if (model.type !== 'language' || SPECIAL_CHAT_MODELS.some((special) => special.id === model.id)) continue
    const chatModel = gatewayCatalogModelToChatModel(model)
    chatModel.supportsZeroDataRetention = ZDR_MODEL_IDS.has(chatModel.id)
    chatModel.intelligence = Math.max(0, 100 - (CHAT_MODEL_QUALITY_PRIORITY.indexOf(chatModel.id) + 1))
    gatewayCatalogModels.set(model.id, chatModel)
    registeredIds.add(chatModel.id)
    registered.push(chatModel)
  }
  rebuildAvailableModels(registered, registeredIds)
  gatewayCatalogRegistered = true
}

export function registerByokModels(connections: readonly ByokConnectionRow[] | unknown): void {
  if (!Array.isArray(connections)) return
  byokModels.clear()
  for (const model of byokConnectionsToChatModels(connections)) {
    byokModels.set(model.id, model)
  }
  const gatewayModels = Array.from(gatewayCatalogModels.values())
  rebuildAvailableModels(gatewayModels, new Set(gatewayModels.map((model) => model.id)))
}

function rebuildAvailableModels(
  registeredGatewayModels: readonly ChatModel[],
  registeredGatewayIds: ReadonlySet<string>,
): void {
  const fallbackMissingFromCatalog = CURATED_FALLBACK_CHAT_MODELS.filter(
    (model) => !registeredGatewayIds.has(model.id),
  )
  AVAILABLE_MODELS.splice(
    0,
    AVAILABLE_MODELS.length,
    ...registeredGatewayModels,
    ...fallbackMissingFromCatalog,
    ...SPECIAL_CHAT_MODELS,
    ...byokModels.values(),
  )
  _intelRange = null
  gatewayCatalogRevision += 1
}

/**
 * Highest quality first — used when picking a default Act model from a multi-model
 * selection and when synthesizing a shared prior thread for newly added chat models.
 */
export const CHAT_MODEL_QUALITY_PRIORITY: string[] = [
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

export function pickBestModelForAct(selectedAskModelIds: string[]): string {
  if (selectedAskModelIds.length === 1) return selectedAskModelIds[0]
  const sel = new Set(selectedAskModelIds)
  for (const id of CHAT_MODEL_QUALITY_PRIORITY) {
    if (sel.has(id)) return id
  }
  const first = selectedAskModelIds.find((id) => AVAILABLE_MODELS.some((m) => m.id === id))
  return first ?? DEFAULT_MODEL_ID
}

/** Persisted UI / Convex rows may still reference retired ids. */
const LEGACY_CHAT_MODEL_ID_ALIASES: Record<string, string> = {
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
  'openrouter/moonshotai/kimi-k2.6:free': FREE_TIER_DEFAULT_MODEL_ID,
  'openrouter/z-ai/glm-4.5-air:free': FREE_TIER_DEFAULT_MODEL_ID,
  'openrouter/inclusionai/ring-2.6-1t:free': FREE_TIER_DEFAULT_MODEL_ID,
  'openrouter/deepseek/deepseek-v4-flash:free': FREE_TIER_DEFAULT_MODEL_ID,
  'openrouter/minimax/minimax-m2.5:free': FREE_TIER_DEFAULT_MODEL_ID,
  'openrouter/arcee-ai/trinity-large-thinking:free': FREE_TIER_DEFAULT_MODEL_ID,
  'openrouter/openai/gpt-oss-120b:free': FREE_TIER_DEFAULT_MODEL_ID,
  'deepseek-ai/deepseek-v3.2': 'stepfun-ai/step-3.5-flash',
  'moonshotai/kimi-k2-thinking': 'stepfun-ai/step-3.5-flash',
  'minimaxai/minimax-m2.7': 'stepfun-ai/step-3.5-flash',
}

export function getModel(id: string): ChatModel | undefined {
  const resolved = LEGACY_CHAT_MODEL_ID_ALIASES[id] ?? id
  return AVAILABLE_MODELS.find((m) => m.id === resolved) ?? gatewayCatalogModels.get(resolved)
}

/** Display-name fallback for enabled IDs that are not in the static/curated catalog yet. */
export function provisionalChatModelFromId(id: string): ChatModel {
  const resolved = LEGACY_CHAT_MODEL_ID_ALIASES[id] ?? id
  const leaf = resolved.split('/').pop() ?? resolved
  const name = leaf
    .replace(/:free$/i, '')
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => {
      if (/^\d/.test(part) || part === part.toUpperCase()) return part
      return part.charAt(0).toUpperCase() + part.slice(1)
    })
    .join(' ')
  const provider = resolved.includes('/') ? resolved.slice(0, resolved.indexOf('/')) : 'unknown'
  const isFree = isFreeTierChatModelId(resolved) || resolved.endsWith(':free')
  return {
    id: resolved,
    name: isFree && !name.toLowerCase().startsWith('free') ? `Free: ${name}` : name,
    provider,
    intelligence: 0,
    cost: isFree ? 0 : 1,
    speedTier: 2,
    supportsVision: false,
    supportsReasoning: false,
    supportsSearch: false,
    supportsZeroDataRetention: ZDR_MODEL_IDS.has(resolved),
  }
}

/** 1–5 segments for relative response latency (higher = faster). */
export function speedTierToBarFill5(tier: ChatModel['speedTier']): number {
  return tier === 1 ? 2 : tier === 2 ? 3 : 5
}

/** 1–5 segments for relative $ (higher = pricier). Free tier uses 1. */
export function costToBarFill5(cost: ChatModel['cost']): number {
  if (cost === 0) return 1
  if (cost === 1) return 2
  if (cost === 2) return 3
  return 5
}

let _intelRange: { min: number; max: number } | null = null
function intelligenceRange(): { min: number; max: number } {
  if (_intelRange) return _intelRange
  const vals = AVAILABLE_MODELS.map((m) => m.intelligence)
  _intelRange = { min: Math.min(...vals), max: Math.max(...vals) }
  return _intelRange
}

/** 1–5 segments for relative intelligence score. */
export function intelligenceToBarFill5(m: ChatModel): number {
  const { min, max } = intelligenceRange()
  if (max <= min) return 3
  const n = Math.round(((m.intelligence - min) / (max - min)) * 4) + 1
  return Math.min(5, Math.max(1, n))
}

/** True when completions are served via the OpenRouter HTTP API. */
export function modelUsesOpenRouterTransport(modelId: string): boolean {
  const p = getModel(modelId)?.provider
  return p === 'openrouter'
}

export function modelSupportsZeroDataRetention(modelId: string): boolean {
  return ZDR_MODEL_IDS.has(LEGACY_CHAT_MODEL_ID_ALIASES[modelId] ?? modelId)
}

export function filterZeroDataRetentionModels(models: ChatModel[]): ChatModel[] {
  return models.filter((m) => m.supportsZeroDataRetention)
}

/** UI labels — resolves legacy / gateway ids (e.g. Kimi instruct variant) to catalog names. */
export function getChatModelDisplayName(modelId: string): string {
  return getModel(modelId)?.name ?? modelId
}

export function getProviderModels(provider: ChatModel['provider']): ChatModel[] {
  return AVAILABLE_MODELS.filter((m) => m.provider === provider)
}

/**
 * Models sorted by intelligence (CHAT_MODEL_QUALITY_PRIORITY order).
 * Free-tier users: free models first (Auto on top), then premium.
 * Paid users: premium first, free section last — so unknown/gateway premium
 * models are never trapped under the FREE divider.
 */
export function getModelsByIntelligence(isFreeTier: boolean): ChatModel[] {
  const idxMap = new Map(CHAT_MODEL_QUALITY_PRIORITY.map((id, i) => [id, i]))
  const sorted = [...AVAILABLE_MODELS].sort(
    (a, b) => (idxMap.get(a.id) ?? 999) - (idxMap.get(b.id) ?? 999),
  )
  const free = sorted.filter((m) => isFreeTierChatModelId(m.id))
  const premium = sorted.filter((m) => !isFreeTierChatModelId(m.id))
  const freeAuto = free.filter((m) => m.id === FREE_TIER_AUTO_MODEL_ID)
  const explicitFree = free.filter((m) => m.id !== FREE_TIER_AUTO_MODEL_ID)
  if (isFreeTier) {
    return [...freeAuto, ...explicitFree, ...premium]
  }
  return [...premium, ...freeAuto, ...explicitFree]
}

export function getEnabledChatModels(
  enabledModelIds: readonly string[],
  isFreeTier: boolean,
  modelOrder?: readonly string[],
): ChatModel[] {
  const ids = enabledModelIds.length > 0 ? enabledModelIds : DEFAULT_CURATED_CHAT_MODEL_IDS
  const enabled = new Set(ids.map((id) => LEGACY_CHAT_MODEL_ID_ALIASES[id] ?? id))
  const curated = getModelsByIntelligence(isFreeTier).filter((model) => enabled.has(model.id))
  const curatedIds = new Set(curated.map((model) => model.id))
  // Keep every enabled id visible even before the gateway catalog has registered —
  // unresolved ids get a provisional entry so the picker never shrinks to 1–2 rows.
  const additional = ids
    .map((id) => LEGACY_CHAT_MODEL_ID_ALIASES[id] ?? id)
    .filter((id) => !curatedIds.has(id))
    .map((id) => getModel(id) ?? (isByokModelId(id) ? undefined : provisionalChatModelFromId(id)))
    .filter((model): model is ChatModel => Boolean(model))
    .sort((a, b) => a.provider.localeCompare(b.provider) || a.name.localeCompare(b.name))
  const ordered = [...curated, ...additional]

  if (modelOrder && modelOrder.length > 0) {
    const normalizedOrder = modelOrder.map((id) => LEGACY_CHAT_MODEL_ID_ALIASES[id] ?? id)
    const orderIndex = new Map(normalizedOrder.map((id, index) => [id, index]))
    const explicitlyOrdered = ordered
      .filter((model) => orderIndex.has(model.id))
      .sort((a, b) => (orderIndex.get(a.id) ?? 0) - (orderIndex.get(b.id) ?? 0))
    const remaining = ordered.filter((model) => !orderIndex.has(model.id))
    return [...explicitlyOrdered, ...remaining]
  }

  const free = ordered.filter((model) => isFreeTierChatModelId(model.id))
  const premium = ordered.filter((model) => !isFreeTierChatModelId(model.id))
  return isFreeTier ? [...free, ...premium] : [...premium, ...free]
}

// ─── Image Models (priority order — top = highest priority fallback) ──────────

export const IMAGE_MODELS: ImageModel[] = [
  { id: 'openai/gpt-image-1.5', name: 'GPT Image 1.5', provider: 'openai', description: 'High quality, detailed', defaultAspectRatio: '1:1' },
  { id: 'xai/grok-imagine-image-pro', name: 'Grok Image Pro', provider: 'xai', description: 'Photorealistic', defaultAspectRatio: '1:1' },
  { id: 'xai/grok-imagine-image', name: 'Grok Image', provider: 'xai', description: 'Fast & creative', defaultAspectRatio: '1:1' },
  { id: 'bfl/flux-2-max', name: 'FLUX 2 Max', provider: 'bfl', description: 'Premium quality', defaultAspectRatio: '1:1' },
  { id: 'prodia/flux-fast-schnell', name: 'FLUX Schnell', provider: 'prodia', description: 'Ultra-fast, low cost', defaultAspectRatio: '1:1' },
  { id: 'bytedance/seedream-5.0-lite', name: 'Seedream 5.0 Lite', provider: 'bytedance', description: 'Fast generation', defaultAspectRatio: '1:1' },
  { id: 'bytedance/seedream-4.5', name: 'Seedream 4.5', provider: 'bytedance', description: 'Balanced quality', defaultAspectRatio: '1:1' },
]

export function getImageModel(id: string): ImageModel | undefined {
  return IMAGE_MODELS.find((m) => m.id === id)
}

// ─── Video Models (priority order — top = highest priority fallback) ──────────

export const VIDEO_MODELS: VideoModel[] = [
  // Text-to-video + Image-to-video
  { id: 'google/veo-3.1-generate-001', name: 'Veo 3.1', provider: 'google', description: 'Highest quality', billingUnit: 'per_video', defaultDuration: 8, defaultAspectRatio: '16:9', subModes: ['text-to-video', 'image-to-video'] },
  { id: 'google/veo-3.1-fast-generate-001', name: 'Veo 3.1 Fast', provider: 'google', description: 'Fast generation', billingUnit: 'per_video', defaultDuration: 8, defaultAspectRatio: '16:9', subModes: ['text-to-video', 'image-to-video'] },
  { id: 'bytedance/seedance-v1.5-pro', name: 'Seedance v1.5 Pro', provider: 'bytedance', description: 'Cinematic quality', billingUnit: 'per_second', defaultDuration: 10, defaultAspectRatio: '16:9', subModes: ['text-to-video', 'image-to-video'] },
  { id: 'xai/grok-imagine-video', name: 'Grok Video', provider: 'xai', description: 'Creative & fast', billingUnit: 'per_video', defaultDuration: 8, defaultAspectRatio: '16:9', subModes: ['text-to-video', 'image-to-video', 'video-editing'] },
  // Text-to-video only
  { id: 'alibaba/wan-v2.6-t2v', name: 'Wan v2.6', provider: 'alibaba', description: 'Versatile', billingUnit: 'per_second', defaultDuration: 8, defaultAspectRatio: '16:9', subModes: ['text-to-video'] },
  { id: 'klingai/kling-v2.6-t2v', name: 'Kling v2.6', provider: 'klingai', description: 'Cinematic motion', billingUnit: 'per_video', defaultDuration: 5, defaultAspectRatio: '16:9', subModes: ['text-to-video'] },
  // Image-to-video only
  { id: 'klingai/kling-v2.6-i2v', name: 'Kling v2.6 I2V', provider: 'klingai', description: 'Animate images', billingUnit: 'per_video', defaultDuration: 5, defaultAspectRatio: '16:9', subModes: ['image-to-video'] },
  { id: 'alibaba/wan-v2.6-i2v', name: 'Wan v2.6 I2V', provider: 'alibaba', description: 'Image animation', billingUnit: 'per_second', defaultDuration: 5, defaultAspectRatio: '16:9', subModes: ['image-to-video'] },
  // Reference-to-video
  { id: 'alibaba/wan-v2.6-r2v', name: 'Wan v2.6 R2V', provider: 'alibaba', description: 'Character references', billingUnit: 'per_second', defaultDuration: 5, defaultAspectRatio: '16:9', subModes: ['reference-to-video'] },
  // Motion control
  { id: 'klingai/kling-v2.6-motion-control', name: 'Kling Motion Control', provider: 'klingai', description: 'Transfer motion', billingUnit: 'per_video', defaultDuration: 5, defaultAspectRatio: '16:9', subModes: ['motion-control'] },
]

export function getVideoModel(id: string): VideoModel | undefined {
  return VIDEO_MODELS.find((m) => m.id === id)
}

export function getVideoModelsBySubMode(subMode: VideoSubMode): VideoModel[] {
  return VIDEO_MODELS.filter((m) => m.subModes.includes(subMode))
}
