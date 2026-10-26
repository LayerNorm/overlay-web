import { FatalError, RetryableError } from 'workflow'
import type { HarnessEvidence, HarnessSnapshot } from '@overlay/agent-runtime/harness-state'
import type { HarnessOperation } from '@overlay/agent-runtime/harness-store'
import { ConvexHarnessRepository } from './ConvexHarnessRepository'
import type { HarnessExecutionPorts } from './ports'

export type HarnessExecutionReference = {
  actorUserId: string
  runId: string
  workflowRunId: string
}

export async function readHarnessState(reference: HarnessExecutionReference): Promise<HarnessSnapshot> {
  'use step'
  const state = await new ConvexHarnessRepository().get({ actorUserId: reference.actorUserId, runId: reference.runId })
  if (!state) throw new FatalError('HARNESS_RUN_NOT_FOUND')
  return state
}

export async function claimHarnessState(reference: HarnessExecutionReference): Promise<boolean> {
  'use step'
  const repository = new ConvexHarnessRepository()
  for (let attempt = 0; attempt < 8; attempt++) {
    const state = await repository.get({ actorUserId: reference.actorUserId, runId: reference.runId })
    if (!state) throw new FatalError('HARNESS_RUN_NOT_FOUND')
    if (state.workflowRunId) return state.workflowRunId === reference.workflowRunId
    const result = await repository.apply({
      actorUserId: reference.actorUserId, runId: reference.runId,
      operationId: `claim:${reference.workflowRunId}`, expectedRevision: state.revision,
      operation: { type: 'claim_execution', workflowRunId: reference.workflowRunId },
    })
    if (!result.conflict) return true
  }
  throw new RetryableError('Harness execution claim is contended.')
}

export async function applyHarnessOperation(
  reference: HarnessExecutionReference,
  operationId: string,
  operation: HarnessOperation,
): Promise<HarnessSnapshot> {
  'use step'
  const repository = new ConvexHarnessRepository()
  for (let attempt = 0; attempt < 8; attempt++) {
    const state = await repository.get({ actorUserId: reference.actorUserId, runId: reference.runId })
    if (!state) throw new FatalError('HARNESS_RUN_NOT_FOUND')
    if (state.workflowRunId !== reference.workflowRunId) throw new FatalError('HARNESS_EXECUTION_NOT_OWNED')
    const result = await repository.apply({
      actorUserId: reference.actorUserId, runId: reference.runId,
      operationId, expectedRevision: state.revision, operation,
    })
    if (!result.conflict) return result.snapshot
  }
  throw new RetryableError('Harness state is contended.')
}

export async function readHarnessEvidence(reference: HarnessExecutionReference, evidenceId: string): Promise<HarnessEvidence | null> {
  'use step'
  return new ConvexHarnessRepository().readEvidence({ actorUserId: reference.actorUserId, runId: reference.runId, evidenceId })
}

export function createHarnessStatePorts(reference: HarnessExecutionReference): Pick<HarnessExecutionPorts, 'claim' | 'read' | 'apply' | 'readEvidence'> {
  return {
    claim: () => claimHarnessState(reference),
    read: () => readHarnessState(reference),
    apply: (operationId, operation) => applyHarnessOperation(reference, operationId, operation),
    readEvidence: evidenceId => readHarnessEvidence(reference, evidenceId),
  }
}
