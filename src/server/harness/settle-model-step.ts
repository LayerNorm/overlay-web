import 'server-only'

import { createHash } from 'node:crypto'
import { FatalError } from 'workflow'
import { validateHarnessReceipt, type HarnessReceipt } from '@overlay/agent-runtime/harness-state'
import { getOverlayServerContext } from '@/server/bootstrap'
import { ConvexHarnessRepository } from './ConvexHarnessRepository'
import type { HarnessModelObservation } from './model-usage'
import { applyHarnessOperation, readHarnessState, type HarnessExecutionReference } from './state-steps'
import { resolveHarnessModelUsage } from './usage-steps'

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

export async function recordHarnessModelBilling(
  reference: HarnessExecutionReference,
  resolved: Awaited<ReturnType<typeof resolveHarnessModelUsage>>,
): Promise<string> {
  'use step'

  const { receipt, providerCostUsd, catalogCostUsd } = resolved
  validateHarnessReceipt(receipt)
  const operationId = `harness-model:${createHash('sha256').update(JSON.stringify([reference.runId, receipt.id])).digest('hex')}`
  const state = await new ConvexHarnessRepository().get({ actorUserId: reference.actorUserId, runId: reference.runId })
  if (!state || state.workflowRunId !== reference.workflowRunId) throw new FatalError('Harness model settlement is not owned by this execution.')
  if (state.latestReceipt?.id === receipt.id) return operationId
  const dispatch = state.modelReservation?.dispatch
  if (state.modelReservation?.id !== receipt.id || !dispatch) throw new FatalError('Harness model settlement has no matching dispatch.')
  const server = getOverlayServerContext()
  if (receipt.costSource === 'external') {
    if (dispatch.billingReservationId !== null) throw new FatalError('External inference cannot settle an Overlay billing reservation.')
    await server.appData.repositories.usage.recordBatch({
      userId: reference.actorUserId, workspaceId: state.policy.workspaceId, operationId,
      forceFreeTierLimits: false,
      events: [{
        kind: 'agent', modelId: dispatch.modelId, countAsRequest: false, costCents: 0,
        inputTokens: receipt.inputTokens, outputTokens: receipt.outputTokens, cachedTokens: receipt.cacheReadTokens,
        occurredAt: state.updatedAt,
        metadata: { costSource: 'external', externalCostMicros: receipt.externalCostMicros ?? null,
          cacheWriteTokens: receipt.cacheWriteTokens, reasoningTokens: receipt.reasoningTokens },
      }],
    })
  } else {
    const result = await server.chatUsagePolicy.recordFinishedUsage({
      userId: reference.actorUserId, workspaceId: state.policy.workspaceId,
      operationId, modelId: receipt.modelId, reservationId: dispatch.billingReservationId,
      countAsRequest: false, requireRecorded: true, forceFreeTierLimits: false,
      inputTokens: receipt.inputTokens, outputTokens: receipt.outputTokens,
      cachedInputTokens: receipt.cacheReadTokens, cacheWriteTokens: receipt.cacheWriteTokens,
      ...(providerCostUsd !== null ? { providerCostUsd } : {}),
      ...(catalogCostUsd !== null ? { catalogCostUsd } : {}),
    })
    if (dispatch.billingReservationId !== null && !result.finalized) {
      throw new FatalError('Harness model billing is awaiting reconciliation.')
    }
  }
  return operationId
}
