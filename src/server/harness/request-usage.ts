import 'server-only'

import { FatalError } from 'workflow'
import { getOverlayServerContext } from '@/server/bootstrap'
import { isByokModelId } from '@/shared/ai/gateway/byok-model-conversion'
import { ConvexHarnessRepository } from './ConvexHarnessRepository'
import type { HarnessExecutionReference } from './state-steps'

/**
 * Body of the step, shared by the combined admission step. It lives outside
 * the step module because the workflow compiler strips step bodies but keeps
 * plain exports, which would pull these server imports into workflow bundles.
 */
export async function recordHarnessRequestUsage(reference: HarnessExecutionReference, modelId: string): Promise<void> {
  const state = await new ConvexHarnessRepository().get({ actorUserId: reference.actorUserId, runId: reference.runId })
  if (!state || state.workflowRunId !== reference.workflowRunId
    || (state.executionGeneration ?? 0) !== (reference.executionGeneration ?? 0)
    || state.authorizationPause
    || !['running', 'waiting_for_input', 'waiting_for_approval', 'waiting_for_children', 'waiting_for_resources'].includes(state.status)) {
    throw new FatalError('HARNESS_EXECUTION_NOT_OWNED')
  }
  if (state.parentRunId || isByokModelId(modelId)) return
  await getOverlayServerContext().appData.repositories.usage.recordBatch({
    userId: state.policy.actorUserId,
    workspaceId: state.policy.workspaceId,
    operationId: `harness:${state.rootRunId}:request`,
    events: [{ kind: 'agent', modelId, countAsRequest: true, costCents: 0, occurredAt: state.updatedAt }],
  })
}
