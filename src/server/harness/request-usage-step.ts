import 'server-only'

import { FatalError } from 'workflow'
import { getOverlayServerContext } from '@/server/bootstrap'
import { isByokModelId } from '@/shared/ai/gateway/byok-model-conversion'
import { ConvexHarnessRepository } from './ConvexHarnessRepository'
import type { HarnessExecutionReference } from './state-steps'

export async function admitHarnessRequestUsage(reference: HarnessExecutionReference, modelId: string): Promise<void> {
  'use step'

  const state = await new ConvexHarnessRepository().get({ actorUserId: reference.actorUserId, runId: reference.runId })
  if (!state || state.workflowRunId !== reference.workflowRunId || state.status !== 'running') {
    throw new FatalError('Harness request is not owned by an active execution.')
  }
  if (state.parentRunId || isByokModelId(modelId)) return
  await getOverlayServerContext().appData.repositories.usage.recordBatch({
    userId: state.policy.actorUserId,
    workspaceId: state.policy.workspaceId,
    operationId: `harness:${state.rootRunId}:request`,
    events: [{ kind: 'agent', modelId, countAsRequest: true, costCents: 0, occurredAt: state.updatedAt }],
  })
}
