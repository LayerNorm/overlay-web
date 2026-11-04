import 'server-only'

import type { HarnessSnapshot } from '@overlay/agent-runtime/harness-state'
import type { HarnessRunnerCheckpoint } from './ports'
import { ConvexHarnessRepository } from './ConvexHarnessRepository'
import type { HarnessExecutionReference } from './state-steps'

export async function handoffHarnessContinuation(input: {
  reference: HarnessExecutionReference
  workflowKind: 'native' | 'personal'
  checkpoint: HarnessRunnerCheckpoint
  launchInput: { access: { runId: string; executionGeneration?: number }; messages: unknown[]; continuation?: unknown }
}): Promise<HarnessSnapshot> {
  'use step'
  const repository = new ConvexHarnessRepository()
  const state = await repository.get({ actorUserId: input.reference.actorUserId, runId: input.reference.runId })
  if (!state || state.workflowRunId !== input.reference.workflowRunId
    || (state.executionGeneration ?? 0) !== (input.reference.executionGeneration ?? 0)) {
    throw new Error('HARNESS_CONTINUATION_OWNER_CHANGED')
  }
  const launchInput = {
    ...input.launchInput,
    messages: [],
    continuation: undefined,
    access: { ...input.launchInput.access, executionGeneration: (state.executionGeneration ?? 0) + 1 },
  }
  try {
    return await repository.handoffContinuation({
      actorUserId: input.reference.actorUserId,
      runId: input.reference.runId,
      workflowRunId: input.reference.workflowRunId,
      executionGeneration: state.executionGeneration ?? 0,
      expectedRevision: state.revision,
      workflowKind: input.workflowKind,
      checkpoint: input.checkpoint,
      launchInput,
    })
  } catch (error) {
    const current = await repository.get({ actorUserId: input.reference.actorUserId, runId: input.reference.runId })
    if (current && !['completed', 'failed', 'cancelled', 'waiting_for_authorization'].includes(current.status) && !current.workflowRunId
      && current.executionGeneration === (state.executionGeneration ?? 0) + 1) return current
    throw error
  }
}
