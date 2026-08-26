import {
  AVAILABLE_MODELS,
  CHAT_MODEL_QUALITY_PRIORITY,
  getModel,
} from '@/shared/ai/gateway/model-data'
import {
  FREE_TIER_AUTO_MODEL_ID,
  isFreeTierChatModelId,
} from '@/shared/ai/gateway/model-types'
import { isByokModelId } from '@/shared/ai/gateway/byok-model-conversion'

type FallbackParams = {
  modelId: string
  paid: boolean
  onlyAllowZdrModels?: boolean
  requiresVision?: boolean
  maxCandidates?: number
}

const HIDDEN_FALLBACK_MODEL_IDS = new Set([
  'nvidia/nemotron-nano-9b-v2',
])

function priorityIndex(modelId: string): number {
  const idx = CHAT_MODEL_QUALITY_PRIORITY.indexOf(modelId)
  return idx === -1 ? 999 : idx
}

function modelPrice(modelId: string): number | null {
  const price = getModel(modelId)?.pricePer1mTokens
  return typeof price === 'number' && Number.isFinite(price) ? price : null
}

function supportsRequiredInputs(modelId: string, params: FallbackParams): boolean {
  const model = getModel(modelId)
  if (!model) return false
  if (HIDDEN_FALLBACK_MODEL_IDS.has(model.id)) return false
  if (params.onlyAllowZdrModels && !model.supportsZeroDataRetention) return false
  if (params.requiresVision && !model.supportsVision) return false
  return true
}

function freeFallbackCandidates(params: FallbackParams): string[] {
  return AVAILABLE_MODELS
    .filter((model) => model.id !== params.modelId)
    .filter((model) => isFreeTierChatModelId(model.id))
    .filter((model) => model.id !== FREE_TIER_AUTO_MODEL_ID)
    .filter((model) => supportsRequiredInputs(model.id, params))
    .sort((a, b) => priorityIndex(a.id) - priorityIndex(b.id))
    .map((model) => model.id)
}

function paidFallbackCandidates(params: FallbackParams): string[] {
  const currentModel = getModel(params.modelId)
  if (!currentModel) return []
  const currentPrice = modelPrice(currentModel.id)
  if (currentPrice === null || currentPrice <= 0) return []

  return AVAILABLE_MODELS
    .filter((model) => model.id !== currentModel.id)
    .filter((model) => !isFreeTierChatModelId(model.id))
    .filter((model) => supportsRequiredInputs(model.id, params))
    .filter((model) => {
      const price = modelPrice(model.id)
      return price !== null && price > 0 && price < currentPrice
    })
    .sort((a, b) => {
      const byPrice = (modelPrice(b.id) ?? 0) - (modelPrice(a.id) ?? 0)
      if (Math.abs(byPrice) > 0.000001) return byPrice
      return priorityIndex(a.id) - priorityIndex(b.id)
    })
    .map((model) => model.id)
}

export function getChatModelFallbackCandidates(params: FallbackParams): string[] {
  if (isByokModelId(params.modelId)) return []
  const candidates = params.paid && !isFreeTierChatModelId(params.modelId)
    ? paidFallbackCandidates(params)
    : freeFallbackCandidates(params)
  return candidates.slice(0, params.maxCandidates ?? 4)
}
