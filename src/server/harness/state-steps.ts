import { ConvexError } from 'convex/values'
import { FatalError, RetryableError } from 'workflow'
import { HarnessPlanValidationError, type HarnessEvidence, type HarnessSnapshot } from '@overlay/agent-runtime/harness-state'
import type { HarnessMutationResult, HarnessOperation } from '@overlay/agent-runtime/harness-store'
import { ConvexHarnessRepository } from './ConvexHarnessRepository'
import { waitForHarnessModelResources } from './resource-boundary'
import { isHarnessStepValidation } from './step-validation'

export type HarnessExecutionReference = {
  actorUserId: string
  runId: string
  workflowRunId: string
}

export type HarnessOperationStepResult =
  | { ok: true; snapshot: HarnessSnapshot }
  | { ok: false; code: 'HARNESS_PLAN_VALIDATION'; message: string }
  | { ok: false; code: 'HARNESS_STEP_VALIDATION'; message: string }
  | { ok: false; code: 'HARNESS_RESOURCE_REQUIRED'; requiredCostMicros: number }

function rejectedOperation(error: unknown): { code: 'HARNESS_OPERATION_REJECTED' | 'HARNESS_PLAN_VALIDATION'; message: string } | null {
  if (!(error instanceof ConvexError) || !error.data || typeof error.data !== 'object') return null
  const data = error.data as { code?: unknown; message?: unknown }
  return (data.code === 'HARNESS_OPERATION_REJECTED' || data.code === 'HARNESS_PLAN_VALIDATION')
    && typeof data.message === 'string' ? { code: data.code, message: data.message } : null
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

export async function applyHarnessOperationStep(
  reference: HarnessExecutionReference,
  operationId: string,
  operation: HarnessOperation,
): Promise<HarnessOperationStepResult> {
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
      const rejected = rejectedOperation(error)
      if (rejected?.code === 'HARNESS_PLAN_VALIDATION') {
        return { ok: false, code: rejected.code, message: rejected.message }
      }
      if (operation.type === 'transition_step' && rejected?.code === 'HARNESS_OPERATION_REJECTED'
        && isHarnessStepValidation(rejected.message)) {
        return { ok: false, code: 'HARNESS_STEP_VALIDATION', message: rejected.message }
      }
      if (operation.type === 'reserve_model' && state.policy.resourcePauseVersion === 1
        && rejected?.code === 'HARNESS_OPERATION_REJECTED'
        && ['The authorized run deadline is exhausted.', 'The authorized spending budget is exhausted.'].includes(rejected.message)) {
        return { ok: false, code: 'HARNESS_RESOURCE_REQUIRED', requiredCostMicros: operation.maxCostMicros }
      }
      if (rejected) throw new FatalError(rejected.message)
      if (error instanceof Error && error.message.includes('ArgumentValidationError')) {
        throw new FatalError('Harness operation rejected: invalid operation arguments.')
      }
      throw error
    }
    if (!result.conflict) return { ok: true, snapshot: result.snapshot }
  }
  throw new RetryableError('Harness state is contended.')
}

export async function applyHarnessOperation(
  reference: HarnessExecutionReference,
  operationId: string,
  operation: HarnessOperation,
): Promise<HarnessSnapshot> {
  while (true) {
    const result = await applyHarnessOperationStep(reference, operationId, operation)
    if (result.ok) return result.snapshot
    if (result.code === 'HARNESS_PLAN_VALIDATION') throw new HarnessPlanValidationError(result.message)
    if (result.code === 'HARNESS_STEP_VALIDATION') throw new Error(result.message)
    const state = await waitForHarnessModelResources(reference, result.requiredCostMicros, () => readHarnessState(reference))
    if (state.status !== 'running') throw new FatalError('Harness model reservation is no longer runnable.')
  }
}

export async function readHarnessEvidence(reference: HarnessExecutionReference, evidenceId: string): Promise<HarnessEvidence | null> {
  'use step'
  return new ConvexHarnessRepository().readEvidence({ actorUserId: reference.actorUserId, runId: reference.runId, evidenceId })
}
