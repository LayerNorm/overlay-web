import 'server-only'

import { FatalError, getStepMetadata, RetryableError } from 'workflow'
import { getOrCreateGateway } from '@/server/ai/gateway/gateway-runtime'
import { correctProviderBudgetReservationCost } from '@/server/billing/billing-runtime'
import { logger } from '@/server/observability/logger'
import { GATEWAY_USAGE_MAX_RETRIES, GATEWAY_USAGE_MAX_RETRY_SECONDS } from './usage-steps'

export type HarnessCostCorrection = {
  actorUserId: string
  generationId: string
  reservationId: string
}

/** Replaces a settled estimate with the exact cost once the gateway reports it. */
export async function correctHarnessModelCost(input: HarnessCostCorrection): Promise<void> {
  'use step'

  const gateway = await getOrCreateGateway()
  let generation: Awaited<ReturnType<typeof gateway.getGenerationInfo>>
  try {
    generation = await gateway.getGenerationInfo({ id: input.generationId })
  } catch (error) {
    if (error && typeof error === 'object' && 'statusCode' in error && error.statusCode === 404) {
      const { attempt } = getStepMetadata()
      if (attempt <= GATEWAY_USAGE_MAX_RETRIES) {
        const retryAfterSeconds = Math.min(2 ** attempt, GATEWAY_USAGE_MAX_RETRY_SECONDS)
        throw new RetryableError('Gateway usage has not been ingested yet.', { retryAfter: `${retryAfterSeconds}s` })
      }
      logger.warn('[harness] exact cost never arrived; the estimate stands', { reservationId: input.reservationId })
      return
    }
    throw new FatalError('Gateway usage lookup failed; the estimate stands.')
  }
  if (generation.id !== input.generationId || generation.isByok) {
    logger.warn('[harness] gateway usage does not match this call; the estimate stands', { reservationId: input.reservationId })
    return
  }
  await correctProviderBudgetReservationCost({
    userId: input.actorUserId, reservationId: input.reservationId, actualProviderCostUsd: generation.totalCost,
  })
}

correctHarnessModelCost.maxRetries = GATEWAY_USAGE_MAX_RETRIES
