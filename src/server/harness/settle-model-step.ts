import { FatalError } from 'workflow'
import type { HarnessReceipt } from '@overlay/agent-runtime/harness-state'
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
