import 'server-only'

import { GatewayModelNotFoundError } from '@ai-sdk/gateway'
import { FatalError } from 'workflow'
import type { HarnessReceipt } from '@overlay/agent-runtime/harness-state'
import { releaseProviderBudgetReservation } from '@/server/billing/billing-runtime'
import { isByokModelId } from '@/shared/ai/gateway/byok-model-conversion'
import { applyHarnessOperation, readHarnessState } from './state-steps'
import type { HarnessModelReference } from './secure-model'

export function isConfirmedHarnessModelRejection(error: unknown): boolean {
  return GatewayModelNotFoundError.isInstance(error) && error.statusCode === 404 && !error.generationId
}

// Called inside the provider step, only before receiving a model stream. A
// timeout, 5xx, rate limit or stream failure retains its unresolved hold.
export async function recordHarnessModelRejection(
  reference: HarnessModelReference,
  reason: NonNullable<HarnessReceipt['rejectionReason']>,
): Promise<void> {
  const input = reference.personal
  if (!input || isByokModelId(reference.modelId)) throw new FatalError('Cannot reject an external model dispatch.')
  const state = await readHarnessState(input.access)
  if (state.workflowRunId !== input.access.workflowRunId) throw new FatalError('Model rejection has no execution owner.')
  if (state.latestReceipt?.id === input.receiptId && state.latestReceipt.rejectionReason === reason) return
  const hold = state.modelReservation
  if (hold?.id !== input.receiptId
    || (reason === 'budget' && hold.dispatch)
    || (reason === 'model_unavailable' && hold.dispatch?.modelId !== reference.modelId)) {
    throw new FatalError('Model rejection has no matching dispatch.')
  }
  if (hold.dispatch?.billingReservationId) {
    await releaseProviderBudgetReservation({ userId: input.access.actorUserId,
      reservationId: hold.dispatch.billingReservationId, reason: 'Gateway rejected an unavailable model before inference.' })
  }
  await applyHarnessOperation(input.access, `rejected:${input.receiptId}`, {
    type: 'record_receipt', receipt: {
      id: input.receiptId, modelId: reference.modelId, provider: reason === 'budget' ? 'overlay-admission' : 'gateway',
      inputTokens: 0, outputTokens: 0, reasoningTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0,
      contextWindow: input.contextWindow, costMicros: 0, costSource: 'catalog', rejectionReason: reason,
    },
  })
}
