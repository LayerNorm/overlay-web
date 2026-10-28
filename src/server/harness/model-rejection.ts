import 'server-only'

import { GatewayModelNotFoundError } from '@ai-sdk/gateway'
import { FatalError } from 'workflow'
import { releaseProviderBudgetReservation } from '@/server/billing/billing-runtime'
import { isByokModelId } from '@/shared/ai/gateway/byok-model-conversion'
import { OPENROUTER_FREE_MODEL_ID, OVERLAY_FREE_MODEL_ID } from '@/shared/ai/gateway/overlay-free-policy'
import { applyHarnessOperation, readHarnessState } from './state-steps'
import type { HarnessModelReference } from './secure-model'

export function isConfirmedHarnessModelRejection(error: unknown): boolean {
  return GatewayModelNotFoundError.isInstance(error) && error.statusCode === 404 && !error.generationId
}

// Called inside the provider step, only before receiving a model stream. A
// confirmed free-router 429 is route capacity; paid and gateway rate limits,
// timeouts, 5xx responses and stream failures retain their unresolved holds.
export async function recordHarnessModelRejection(
  reference: HarnessModelReference,
  reason: 'budget' | 'model_unavailable' | 'route_capacity' | 'route_interrupted',
): Promise<void> {
  if (reference.personal && reference.native) throw new FatalError('Model rejection has ambiguous execution authority.')
  const input = reference.personal ?? reference.native
  if (!input || isByokModelId(reference.modelId)) throw new FatalError('Cannot reject an external model dispatch.')
  if ((reason === 'route_capacity' || reason === 'route_interrupted')
    && reference.modelId !== OPENROUTER_FREE_MODEL_ID && reference.modelId !== OVERLAY_FREE_MODEL_ID) {
    throw new FatalError('Only the free router can record this rejection.')
  }
  const state = await readHarnessState(input.access)
  if (state.workflowRunId !== input.access.workflowRunId) throw new FatalError('Model rejection has no execution owner.')
  if (state.latestReceipt?.id === input.receiptId && state.latestReceipt.rejectionReason === reason) return
  const hold = state.modelReservation
  if (hold?.id !== input.receiptId
    || (reason === 'budget' && hold.dispatch)
    || (reason !== 'budget' && hold.dispatch?.modelId !== reference.modelId)) {
    throw new FatalError('Model rejection has no matching dispatch.')
  }
  if (reason === 'route_interrupted'
    && (hold.maxCostMicros !== 0 || hold.dispatch?.billingReservationId !== null)) {
    throw new FatalError('A route interruption requires a zero-cost dispatch without a billing reservation.')
  }
  if (hold.dispatch?.billingReservationId) {
    await releaseProviderBudgetReservation({ userId: input.access.actorUserId,
      reservationId: hold.dispatch.billingReservationId, reason: reason === 'route_capacity'
        ? 'The free router had no capacity; no provider inference was attempted.'
        : 'Gateway rejected an unavailable model before inference.' })
  }
  await applyHarnessOperation(input.access, `rejected:${input.receiptId}`, {
    type: 'record_receipt', receipt: {
      id: input.receiptId, modelId: reference.modelId,
      provider: reason === 'budget' ? 'overlay-admission' : reason === 'route_capacity' || reason === 'route_interrupted' ? 'overlay-free-router' : 'gateway',
      inputTokens: 0, outputTokens: 0, reasoningTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0,
      contextWindow: input.contextWindow, costMicros: 0, costSource: 'catalog', rejectionReason: reason,
    },
  })
}
