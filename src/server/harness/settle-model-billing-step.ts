import 'server-only'

import { createHash } from 'node:crypto'
import { FatalError } from 'workflow'
import { validateHarnessReceipt } from '@overlay/agent-runtime/harness-state'
import { getOverlayServerContext } from '@/server/bootstrap'
import { ConvexHarnessRepository } from './ConvexHarnessRepository'
import type { HarnessExecutionReference } from './state-steps'
import type { resolveHarnessModelUsage } from './usage-steps'

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
    await server.appData.repositories.usage.recordBatch({
      userId: reference.actorUserId, workspaceId: state.policy.workspaceId, operationId,
      events: [{
        kind: 'agent', modelId: dispatch.modelId, countAsRequest: false, costCents: 0,
        inputTokens: receipt.inputTokens, outputTokens: receipt.outputTokens, cachedTokens: receipt.cacheReadTokens,
        occurredAt: state.updatedAt,
        metadata: { costSource: 'external', externalCostMicros: receipt.externalCostMicros ?? null,
          cacheWriteTokens: receipt.cacheWriteTokens, reasoningTokens: receipt.reasoningTokens },
      }],
    })
  } else {
    // Charged directly at the cost known at settlement (provider receipt, else catalog
    // pricing); nothing was reserved before the call and nothing corrects it later.
    await server.chatUsagePolicy.recordFinishedUsage({
      userId: reference.actorUserId, workspaceId: state.policy.workspaceId,
      operationId, modelId: receipt.modelId,
      countAsRequest: false, requireRecorded: true,
      inputTokens: receipt.inputTokens, outputTokens: receipt.outputTokens,
      cachedInputTokens: receipt.cacheReadTokens, cacheWriteTokens: receipt.cacheWriteTokens,
      ...(providerCostUsd !== null ? { providerCostUsd } : {}),
      ...(catalogCostUsd !== null ? { catalogCostUsd } : {}),
    })
  }
  return operationId
}
