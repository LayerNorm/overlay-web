import 'server-only'

import { GatewayModelNotFoundError } from '@ai-sdk/gateway'
import { FatalError } from 'workflow'
import { releaseProviderBudgetReservation } from '@/server/billing/billing-runtime'
import { isByokModelId } from '@/shared/ai/gateway/byok-model-conversion'
import { applyHarnessOperation, readHarnessState } from './state-steps'
import type { HarnessModelReference } from './secure-model'

export function isConfirmedHarnessModelRejection(error: unknown): boolean {
  return GatewayModelNotFoundError.isInstance(error) && error.statusCode === 404 && !error.generationId
}

type HarnessModelRejectionReason = 'budget' | 'model_unavailable'

function assertModelRejectionAuthority(reference: HarnessModelReference, _reason: HarnessModelRejectionReason) {
  if (reference.personal && reference.native) throw new FatalError('Model rejection has ambiguous execution authority.')
  const input = reference.personal ?? reference.native
  if (!input || isByokModelId(reference.modelId)) throw new FatalError('Cannot reject an external model dispatch.')
  return input
}

function assertMatchingModelDispatch(
  state: Awaited<ReturnType<typeof readHarnessState>>,
  reference: HarnessModelReference,
  input: NonNullable<HarnessModelReference['personal']> | NonNullable<HarnessModelReference['native']>,
  reason: HarnessModelRejectionReason,
) {
  const hold = state.modelReservation
  if (hold?.id !== input.receiptId
    || (reason === 'budget' && hold.dispatch)
    || (reason !== 'budget' && hold.dispatch?.modelId !== reference.modelId)) {
    throw new FatalError('Model rejection has no matching dispatch.')
  }
  return hold
}

function providerForRejection(reason: HarnessModelRejectionReason) {
  if (reason === 'budget') return 'overlay-admission'
  return 'gateway'
}

// Called inside the provider step only before a stream is received.
export async function recordHarnessModelRejection(
  reference: HarnessModelReference,
  reason: HarnessModelRejectionReason,
): Promise<void> {
  const input = assertModelRejectionAuthority(reference, reason)
  const state = await readHarnessState(input.access)
  if (state.workflowRunId !== input.access.workflowRunId) throw new FatalError('Model rejection has no execution owner.')
  if (state.latestReceipt?.id === input.receiptId && state.latestReceipt.rejectionReason === reason) return
  const hold = assertMatchingModelDispatch(state, reference, input, reason)
  if (hold.dispatch?.billingReservationId) {
    await releaseProviderBudgetReservation({ userId: input.access.actorUserId,
      reservationId: hold.dispatch.billingReservationId, reason: 'Gateway rejected an unavailable model before inference.' })
  }
  await applyHarnessOperation(input.access, `rejected:${input.receiptId}`, {
    type: 'record_receipt', receipt: {
      id: input.receiptId, modelId: reference.modelId,
      provider: providerForRejection(reason),
      inputTokens: 0, outputTokens: 0, reasoningTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0,
      contextWindow: input.contextWindow, costMicros: 0, costSource: 'catalog', rejectionReason: reason,
    },
  })
}
