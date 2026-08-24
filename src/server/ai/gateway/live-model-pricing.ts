import 'server-only'

import { logger } from '@/server/observability/logger'
import { summarizeErrorForLog } from '@/shared/security/safe-log'
import {
  calculateGatewayEmbeddingCostOrNull,
  calculateGatewayImageCostOrNull,
  calculateGatewayLanguageTokenCostOrNull,
  calculateGatewayVideoCostOrNull,
} from '@/shared/ai/gateway/model-pricing'
import { isFreeTierChatModelId } from '@/shared/ai/gateway/model-types'
import { getGatewayCatalogModel } from './gateway-catalog'

export async function calculateLanguageModelTokenCostOrNull(
  modelId: string,
  inputTokens: number,
  cachedInputTokens: number,
  outputTokens: number,
): Promise<number | null> {
  if (isFreeTierChatModelId(modelId)) return 0

  try {
    const model = await getGatewayCatalogModel(modelId)
    if (!model || model.type !== 'language') return null
    return calculateGatewayLanguageTokenCostOrNull(
      model.pricing,
      inputTokens,
      cachedInputTokens,
      outputTokens,
    )
  } catch (error) {
    logger.error('[ai/gateway] Failed to resolve live model pricing', {
      modelId,
      error: summarizeErrorForLog(error),
    })
    return null
  }
}

export async function calculateEmbeddingModelCostOrNull(
  modelId: string,
  inputTokens: number,
): Promise<number | null> {
  const model = await getGatewayCatalogModel(modelId)
  return model?.type === 'embedding'
    ? calculateGatewayEmbeddingCostOrNull(model.pricing, inputTokens)
    : null
}

export async function calculateImageModelCostOrNull(
  modelId: string,
  usage?: { inputTokens: number | undefined; outputTokens: number | undefined },
): Promise<number | null> {
  const model = await getGatewayCatalogModel(modelId)
  return model?.type === 'image'
    ? calculateGatewayImageCostOrNull(modelId, model.pricing, usage)
    : null
}

export async function calculateVideoModelCostOrNull(
  modelId: string,
  durationSeconds: number,
): Promise<number | null> {
  const model = await getGatewayCatalogModel(modelId)
  return model?.type === 'video'
    ? calculateGatewayVideoCostOrNull(model.pricing, durationSeconds)
    : null
}
