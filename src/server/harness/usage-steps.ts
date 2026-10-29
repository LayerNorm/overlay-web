import 'server-only'

import { FatalError, getStepMetadata, RetryableError } from 'workflow'
import type { HarnessReceipt } from '@overlay/agent-runtime/harness-state'
import { getOrCreateGateway } from '@/server/ai/gateway/gateway-runtime'
import { calculateLanguageModelTokenCostOrNull } from '@/server/ai/gateway/live-model-pricing'
import { isByokModelId } from '@/shared/ai/gateway/byok-model-conversion'
import { harnessCostMicros, type HarnessModelObservation } from './model-usage'

const GATEWAY_USAGE_MAX_RETRIES = 14
const GATEWAY_USAGE_MAX_RETRY_SECONDS = 60

type HarnessModelUsageResolution = {
  receipt: HarnessReceipt
  providerCostUsd: number | null
  catalogCostUsd: number | null
}

type HarnessReceiptBase = Omit<HarnessReceipt, 'costMicros' | 'costSource' | 'externalCostMicros'>

async function resolveCatalogUsage(
  observation: Omit<HarnessModelObservation, 'generationId'>,
  base: HarnessReceiptBase,
): Promise<HarnessModelUsageResolution> {
  const estimate = await calculateLanguageModelTokenCostOrNull(observation.modelId,
    observation.inputTokens, observation.cacheReadTokens, observation.outputTokens, observation.cacheWriteTokens)
  if (estimate === null) throw new FatalError('Provider cost is unknown; reconcile the model reservation.')
  return {
    receipt: { ...base, costMicros: harnessCostMicros(estimate), costSource: 'catalog' },
    providerCostUsd: null,
    catalogCostUsd: estimate,
  }
}

export async function resolveHarnessModelUsage(input: {
  receiptId: string
  requestedModelId: string
  contextWindow: number | null
  observation: HarnessModelObservation
}): Promise<HarnessModelUsageResolution> {
  'use step'

  const { generationId, ...observation } = input.observation
  const base = { ...observation, id: input.receiptId, contextWindow: input.contextWindow }
  if (isByokModelId(input.requestedModelId)) {
    return {
      receipt: { ...base, costMicros: 0, costSource: 'external', externalCostMicros: null },
      providerCostUsd: null,
      catalogCostUsd: null,
    }
  }
  if (generationId) {
    const gateway = await getOrCreateGateway()
    let generation: Awaited<ReturnType<typeof gateway.getGenerationInfo>>
    try {
      generation = await gateway.getGenerationInfo({ id: generationId })
    } catch (error) {
      if (error && typeof error === 'object' && 'statusCode' in error && error.statusCode === 404) {
        const { attempt } = getStepMetadata()
        if (attempt <= GATEWAY_USAGE_MAX_RETRIES) {
          const retryAfterSeconds = Math.min(2 ** attempt, GATEWAY_USAGE_MAX_RETRY_SECONDS)
          throw new RetryableError('Gateway usage has not been ingested yet.', { retryAfter: `${retryAfterSeconds}s` })
        }
        return resolveCatalogUsage(observation, base)
      }
      throw new FatalError('Gateway usage lookup failed; reconcile the model reservation.')
    }
    if (generation.id !== generationId || !generation.model || !generation.providerName || generation.isByok) {
      throw new FatalError('Provider funding or routing identity needs reconciliation.')
    }
    return {
      receipt: { ...base, modelId: generation.model, provider: generation.providerName,
        costMicros: harnessCostMicros(generation.totalCost), costSource: 'provider' },
      providerCostUsd: generation.totalCost,
      catalogCostUsd: null,
    }
  }
  return resolveCatalogUsage(observation, base)
}

resolveHarnessModelUsage.maxRetries = GATEWAY_USAGE_MAX_RETRIES
