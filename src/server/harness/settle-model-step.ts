import { FatalError } from 'workflow'
import type { HarnessReceipt } from '@overlay/agent-runtime/harness-state'
import { OPENROUTER_FREE_MODEL_ID, OVERLAY_FREE_MODEL_ID } from '@/shared/ai/gateway/overlay-free-policy'
import type { HarnessModelObservation } from './model-usage'
import { applyHarnessOperation, readHarnessState, type HarnessExecutionReference } from './state-steps'
import { resolveHarnessModelUsage } from './usage-steps'
import { recordHarnessModelBilling } from './settle-model-billing-step'

export async function settleHarnessModelUsage(input: {
  reference: HarnessExecutionReference
  receiptId: string
  contextWindow: number | null
  observation: HarnessModelObservation
}): Promise<HarnessReceipt> {
  const { reference, receiptId } = input
  const state = await readHarnessState(reference)
  if (!state || state.workflowRunId !== reference.workflowRunId) throw new FatalError('Harness model settlement is not owned by this execution.')
  // Account settlement preceded this receipt, so a lost step acknowledgement
  // must not reprice or charge it again. Terminal runs still accept late usage.
  if (state.latestReceipt?.id === receiptId) return state.latestReceipt
  const reservation = state.modelReservation
  const dispatch = reservation?.dispatch
  if (reservation?.id !== receiptId || !dispatch) throw new FatalError('Harness model settlement has no matching dispatch.')
  const resolved = await resolveHarnessModelUsage({
    receiptId, contextWindow: input.contextWindow, observation: input.observation,
    requestedModelId: dispatch.modelId,
  })
  const operationId = await recordHarnessModelBilling(reference, resolved)
  await applyHarnessOperation(reference, operationId, { type: 'record_receipt', receipt: resolved.receipt })
  return resolved.receipt
}

export async function releaseFreeSummaryFailure(input: {
  reference: HarnessExecutionReference
  receiptId: string
  modelId: string
  contextWindow: number | null
}): Promise<void> {
  'use step'

  if (input.modelId !== OPENROUTER_FREE_MODEL_ID && input.modelId !== OVERLAY_FREE_MODEL_ID) return
  const state = await readHarnessState(input.reference)
  if (!state || state.workflowRunId !== input.reference.workflowRunId) {
    throw new FatalError('Summary failure has no execution owner.')
  }
  if (state.latestReceipt?.id === input.receiptId) return
  const reservation = state.modelReservation
  if (reservation?.id !== input.receiptId || reservation.maxCostMicros !== 0) return
  if (reservation.dispatch?.modelId !== undefined && reservation.dispatch.modelId !== input.modelId) {
    throw new FatalError('Summary failure has a mismatched model dispatch.')
  }
  if (reservation.dispatch?.billingReservationId) {
    throw new FatalError('Zero-cost summary failure has an unexpected billing reservation.')
  }
  await applyHarnessOperation(input.reference, `summary-failed:${input.receiptId}`, {
    type: 'record_receipt',
    receipt: {
      id: input.receiptId,
      modelId: input.modelId,
      provider: 'overlay-free-router',
      inputTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      contextWindow: input.contextWindow,
      costMicros: 0,
      costSource: 'catalog',
      rejectionReason: 'summary_failed',
    },
  })
}
