import 'server-only'

import { FatalError, getStepMetadata, RetryableError } from 'workflow'
import type { HarnessReceipt } from '@overlay/agent-runtime/harness-state'
import { getOrCreateGateway } from '@/server/ai/gateway/gateway-runtime'
import { calculateLanguageModelTokenCostOrNull } from '@/server/ai/gateway/live-model-pricing'
import { isByokModelId } from '@/shared/ai/gateway/byok-model-conversion'
import { harnessCostMicros, type HarnessModelObservation } from './model-usage'

export const GATEWAY_USAGE_MAX_RETRIES = 14
export const GATEWAY_USAGE_MAX_RETRY_SECONDS = 60

type HarnessModelUsageResolution = {
  receipt: HarnessReceipt
  providerCostUsd: number | null
  catalogCostUsd: number | null
  /** Set when settling from an estimate, so the exact cost can correct it later. */
  correctionGenerationId?: string
}

type HarnessReceiptBase = Omit<HarnessReceipt, 'costMicros' | 'costSource' | 'externalCostMicros'>

async function catalogEstimate(
  observation: Omit<HarnessModelObservation, 'generationId'>,
): Promise<number | null> {
  return calculateLanguageModelTokenCostOrNull(observation.modelId,
    observation.inputTokens, observation.cacheReadTokens, observation.outputTokens, observation.cacheWriteTokens)
}

function catalogUsage(estimate: number, base: HarnessReceiptBase): HarnessModelUsageResolution {
  return {
    receipt: { ...base, costMicros: harnessCostMicros(estimate), costSource: 'catalog' },
    providerCostUsd: null,
    catalogCostUsd: estimate,
  }
}

async function resolveCatalogUsage(
  observation: Omit<HarnessModelObservation, 'generationId'>,
  base: HarnessReceiptBase,
): Promise<HarnessModelUsageResolution> {
  const estimate = await catalogEstimate(observation)
  if (estimate === null) throw new FatalError('Provider cost is unknown; reconcile the model reservation.')
  return catalogUsage(estimate, base)
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
  // Gateway usage takes seconds to appear, so a run never waits for it when a
  // catalog price exists. The exact cost corrects this estimate in the background.
  const estimate = await catalogEstimate(observation)
  if (estimate !== null) {
    return { ...catalogUsage(estimate, base), ...(generationId ? { correctionGenerationId: generationId } : {}) }
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
