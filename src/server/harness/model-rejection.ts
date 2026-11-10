import 'server-only'

import { GatewayModelNotFoundError } from '@ai-sdk/gateway'
import { FatalError } from 'workflow'
import { isByokModelId } from '@/shared/ai/gateway/byok-model-conversion'
import { applyHarnessOperation, readHarnessState } from './state-steps'
import type { HarnessModelReference } from './secure-model'

export function isConfirmedHarnessModelRejection(error: unknown): boolean {
  return GatewayModelNotFoundError.isInstance(error) && error.statusCode === 404 && !error.generationId
}

type HarnessModelRejectionReason = 'model_unavailable'

function assertModelRejectionAuthority(reference: HarnessModelReference) {
  if (reference.personal && reference.native) throw new FatalError('Model rejection has ambiguous execution authority.')
  const input = reference.personal ?? reference.native
  if (!input || isByokModelId(reference.modelId)) throw new FatalError('Cannot reject an external model dispatch.')
  return input
}

// Called inside the provider step only before a stream is received. Nothing was
// charged: the call is billed only after it settles.
export async function recordHarnessModelRejection(
  reference: HarnessModelReference,
  reason: HarnessModelRejectionReason,
): Promise<void> {
  const input = assertModelRejectionAuthority(reference)
  const state = await readHarnessState(input.access)
  if (state.workflowRunId !== input.access.workflowRunId) throw new FatalError('Model rejection has no execution owner.')
  if (state.latestReceipt?.id === input.receiptId && state.latestReceipt.rejectionReason === reason) return
  if (state.modelReservation?.id !== input.receiptId || state.modelReservation.dispatch?.modelId !== reference.modelId) {
    throw new FatalError('Model rejection has no matching dispatch.')
  }
  await applyHarnessOperation(input.access, `rejected:${input.receiptId}`, {
    type: 'record_receipt', receipt: {
      id: input.receiptId, modelId: reference.modelId, provider: 'gateway',
      inputTokens: 0, outputTokens: 0, reasoningTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0,
      contextWindow: input.contextWindow, costMicros: 0, costSource: 'catalog', rejectionReason: reason,
    },
  })
}
