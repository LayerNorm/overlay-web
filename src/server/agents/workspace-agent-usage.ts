import 'server-only'

import { getOverlayServerContext } from '@/server/bootstrap'
import type { WorkspaceAgentPreparedContext } from './workspace-agent-durable'

export async function settleWorkspaceAgentUsageWithPolicy(
  usagePolicy: ReturnType<typeof getOverlayServerContext>['chatUsagePolicy'],
  input: {
    actorUserId: string
    prepared: WorkspaceAgentPreparedContext
    inputTokens: number
    outputTokens: number
    usageKnown: boolean
    providerCallStarted: boolean
    providerOutcomeAmbiguous: boolean
  },
) {
  const reconciliationMessage = `native_agent_usage_settlement_failed:model=${input.prepared.modelId};input_tokens=${input.inputTokens};output_tokens=${input.outputTokens}`
  if (input.providerOutcomeAmbiguous || !input.usageKnown) {
    if (input.prepared.reservationId) {
      await usagePolicy.markReservationForReconcile({
        errorMessage: `native_agent_usage_incomplete:model=${input.prepared.modelId};input_tokens=${input.inputTokens};output_tokens=${input.outputTokens};provider_call_started=${input.providerCallStarted}`,
        reservationId: input.prepared.reservationId,
        userId: input.actorUserId,
      })
    }
    return { settled: false, reconciled: Boolean(input.prepared.reservationId) }
  }
  if (input.inputTokens === 0 && input.outputTokens === 0) {
    if (input.prepared.reservationId) {
      await usagePolicy.releaseReservation({
        reason: input.providerCallStarted ? 'Agent provider returned zero token usage.' : 'Agent provider was not called.',
        reservationId: input.prepared.reservationId,
        userId: input.actorUserId,
      })
    }
    return { settled: true, reconciled: false }
  }
  let result: Awaited<ReturnType<typeof usagePolicy.recordFinishedUsage>>
  try {
    result = await usagePolicy.recordFinishedUsage({
      forceFreeTierLimits: !input.prepared.paid,
      inputTokens: input.inputTokens,
      modelId: input.prepared.modelId,
      operationId: input.prepared.invocationNonce,
      outputTokens: input.outputTokens,
      reservationId: input.prepared.reservationId,
      userId: input.actorUserId,
    })
  } catch (error) {
    if (!input.prepared.reservationId) throw error
    await usagePolicy.markReservationForReconcile({
      errorMessage: reconciliationMessage,
      reservationId: input.prepared.reservationId,
      userId: input.actorUserId,
    })
    return { settled: false, reconciled: true }
  }
  if (input.prepared.reservationId && !result.finalized) {
    await usagePolicy.markReservationForReconcile({
      errorMessage: reconciliationMessage,
      reservationId: input.prepared.reservationId,
      userId: input.actorUserId,
    })
    return { settled: false, reconciled: true }
  }
  return { settled: result.finalized || !input.prepared.reservationId, reconciled: false }
}

export async function settleWorkspaceAgentUsage(input: Parameters<typeof settleWorkspaceAgentUsageWithPolicy>[1]) {
  'use step'
  return await settleWorkspaceAgentUsageWithPolicy(
    getOverlayServerContext().chatUsagePolicy,
    input,
  )
}

export async function releaseWorkspaceAgentReservation(input: {
  actorUserId: string
  prepared: WorkspaceAgentPreparedContext
}) {
  'use step'
  await getOverlayServerContext().chatUsagePolicy.releaseReservation({
    reservationId: input.prepared.reservationId,
    userId: input.actorUserId,
  })
}
