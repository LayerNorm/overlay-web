import 'server-only'

import { FatalError, RetryableError } from 'workflow'
import type { HarnessReceipt } from '@overlay/agent-runtime/harness-state'
import { getOrCreateGateway } from '@/server/ai/gateway/gateway-runtime'
import { calculateLanguageModelTokenCostOrNull } from '@/server/ai/gateway/live-model-pricing'
import { isByokModelId } from '@/shared/ai/gateway/byok-model-conversion'
import { harnessCostMicros, type HarnessModelObservation } from './model-usage'

export async function resolveHarnessModelUsage(input: {
  receiptId: string
  requestedModelId: string
  contextWindow: number | null
  observation: HarnessModelObservation
}): Promise<{ receipt: HarnessReceipt; providerCostUsd: number | null }> {
  'use step'

  const { generationId, ...observation } = input.observation
  const base = { ...observation, id: input.receiptId, contextWindow: input.contextWindow }
  if (isByokModelId(input.requestedModelId)) {
    return {
      receipt: { ...base, costMicros: 0, costSource: 'external', externalCostMicros: null },
      providerCostUsd: null,
    }
  }
  if (generationId) {
    const gateway = await getOrCreateGateway()
    let generation: Awaited<ReturnType<typeof gateway.getGenerationInfo>>
    try {
      generation = await gateway.getGenerationInfo({ id: generationId })
    } catch (error) {
      if (error && typeof error === 'object' && 'statusCode' in error && error.statusCode === 404) {
        throw new RetryableError('Gateway usage has not been ingested yet.', { retryAfter: '2s' })
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
    }
  }
  const estimate = await calculateLanguageModelTokenCostOrNull(observation.modelId,
    observation.inputTokens, observation.cacheReadTokens, observation.outputTokens, observation.cacheWriteTokens)
  if (estimate === null) throw new FatalError('Provider cost is unknown; reconcile the model reservation.')
  return {
    receipt: { ...base, costMicros: harnessCostMicros(estimate), costSource: 'catalog' },
    providerCostUsd: null,
  }
}

resolveHarnessModelUsage.maxRetries = 10
