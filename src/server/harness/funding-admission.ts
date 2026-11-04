import 'server-only'

import { ActConversationServiceError } from '@/server/conversations/ActEntitlementService'
import { ConvexHarnessRepository } from './ConvexHarnessRepository'
import type { HarnessExecutionReference } from './state-steps'

/** Waiting is permitted; this never authorizes execution or renews a lease. */
export async function pendingHarnessPaymentVerification(
  error: unknown,
  reference: HarnessExecutionReference & { workspaceId: string },
): Promise<boolean> {
  if (!(error instanceof ActConversationServiceError) || error.statusCode !== 402
    || error.payload.error !== 'payment_pending') return false
  const state = await new ConvexHarnessRepository().get({ actorUserId: reference.actorUserId, runId: reference.runId })
  return Boolean(state && state.policy.actorUserId === reference.actorUserId
    && state.policy.workspaceId === reference.workspaceId
    && state.workflowRunId === reference.workflowRunId
    && (state.executionGeneration ?? 0) === (reference.executionGeneration ?? 0)
    && state.status === 'waiting_for_resources' && state.resourcePause
    && state.policy.executionPolicyVersion === 2 && state.policy.spendingMode === 'workspace')
}
