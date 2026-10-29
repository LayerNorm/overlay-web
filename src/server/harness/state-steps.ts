import { ConvexError } from 'convex/values'
import { FatalError, RetryableError } from 'workflow'
import type { HarnessEvidence, HarnessSnapshot } from '@overlay/agent-runtime/harness-state'
import type { HarnessMutationResult, HarnessOperation } from '@overlay/agent-runtime/harness-store'
import { ConvexHarnessRepository } from './ConvexHarnessRepository'

export type HarnessExecutionReference = {
  actorUserId: string
  runId: string
  workflowRunId: string
}

function rejectedOperationMessage(error: unknown): string | null {
  if (!(error instanceof ConvexError) || !error.data || typeof error.data !== 'object') return null
  const data = error.data as { code?: unknown; message?: unknown }
  return data.code === 'HARNESS_OPERATION_REJECTED' && typeof data.message === 'string' ? data.message : null
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
    let result: HarnessMutationResult
    try {
      result = await repository.apply({
        actorUserId: reference.actorUserId, runId: reference.runId,
        operationId, expectedRevision: state.revision, operation,
      })
    } catch (error) {
      const message = rejectedOperationMessage(error)
      if (message !== null) throw new FatalError(message)
      if (error instanceof Error && error.message.includes('ArgumentValidationError')) {
        throw new FatalError('Harness operation rejected: invalid operation arguments.')
      }
      throw error
    }
    if (!result.conflict) return result.snapshot
  }
  throw new RetryableError('Harness state is contended.')
}

export async function readHarnessEvidence(reference: HarnessExecutionReference, evidenceId: string): Promise<HarnessEvidence | null> {
  'use step'
  return new ConvexHarnessRepository().readEvidence({ actorUserId: reference.actorUserId, runId: reference.runId, evidenceId })
}
