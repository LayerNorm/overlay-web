import { ConvexError } from 'convex/values'
import { beforeEach, expect, test, vi } from 'vitest'
import { FatalError } from 'workflow'
import { HarnessPlanValidationError } from '@overlay/agent-runtime/harness-state'
import { applyHarnessOperation, applyHarnessOperationStep, claimHarnessState, readAndClaimHarnessState } from './state-steps'

const mocks = vi.hoisted(() => ({ get: vi.fn(), apply: vi.fn(), resources: vi.fn() }))
vi.mock('./resource-boundary', () => ({ waitForHarnessModelResources: mocks.resources }))

vi.mock('./ConvexHarnessRepository', () => ({
  ConvexHarnessRepository: class {
    get = mocks.get
    apply = mocks.apply
  },
}))

const reference = { actorUserId: 'user', runId: 'run', workflowRunId: 'workflow' }

beforeEach(() => {
  vi.resetAllMocks()
  mocks.get.mockResolvedValue({ workflowRunId: reference.workflowRunId, revision: 3 })
})

test('typed rejected operations become fatal without retrying the mutation', async () => {
  mocks.apply.mockRejectedValue(new ConvexError({
    code: 'HARNESS_OPERATION_REJECTED',
    message: 'Evidence must reference successful observations from this run.',
  }))

  let rejection: unknown
  try {
    await applyHarnessOperation(reference, 'invalid-update', {
      type: 'transition_step', id: 'work', status: 'done', evidenceRefs: ['missing'],
    })
  } catch (error) {
    rejection = error
  }
  expect(rejection).toBeInstanceOf(FatalError)
  expect(rejection).toMatchObject({
    message: 'Evidence must reference successful observations from this run.',
  })
  expect(mocks.apply).toHaveBeenCalledOnce()
})

test('plan validation crosses the step boundary as data and is reconstructed by the wrapper', async () => {
  const message = 'Milestone "work" lists unsupported evidence tool "missing_tool".'
  mocks.apply.mockRejectedValue(new ConvexError({
    code: 'HARNESS_PLAN_VALIDATION',
    message,
  }))

  const stepResult = await applyHarnessOperationStep(reference, 'invalid-plan', {
    type: 'replace_plan', steps: [],
  })
  expect(stepResult).toEqual({ ok: false, code: 'HARNESS_PLAN_VALIDATION', message })
  expect(structuredClone(stepResult)).toEqual(stepResult)

  const rejection = await applyHarnessOperation(reference, 'invalid-plan', {
    type: 'replace_plan', steps: [],
  }).catch(error => error)
  expect(rejection).toBeInstanceOf(HarnessPlanValidationError)
  expect(rejection).toMatchObject({ code: 'HARNESS_PLAN_VALIDATION', message })
})

test('execution ownership rejection remains fatal', async () => {
  mocks.get.mockResolvedValue({ workflowRunId: 'another-workflow', revision: 3 })

  await expect(applyHarnessOperationStep(reference, 'unauthorized-update', {
    type: 'transition_step', id: 'work', status: 'done',
  })).rejects.toMatchObject({
    name: 'FatalError',
    message: 'HARNESS_EXECUTION_NOT_OWNED',
  })
  expect(mocks.apply).not.toHaveBeenCalled()
})

test.each(['model:0', 'summary:model:0:0'])('versioned reservation %s waits on resource rejection before retrying the same operation', async id => {
  const state = { workflowRunId: reference.workflowRunId, revision: 3, status: 'running', policy: { resourcePauseVersion: 1 } }
  mocks.get.mockResolvedValue(state)
  const exhausted = new ConvexError({ code: 'HARNESS_OPERATION_REJECTED', message: 'The authorized run deadline is exhausted.' })
  const operation = { type: 'reserve_model' as const, id, maxCostMicros: 7 }
  mocks.apply.mockRejectedValueOnce(exhausted)
  const rejection = await applyHarnessOperationStep(reference, `reserve:${id}`, operation)
  expect(rejection).toEqual({ ok: false, code: 'HARNESS_RESOURCE_REQUIRED', requiredCostMicros: 7 })
  expect(structuredClone(rejection)).toEqual(rejection)
  mocks.apply.mockRejectedValueOnce(exhausted).mockResolvedValueOnce({ conflict: false, snapshot: state })
  mocks.resources.mockResolvedValue(state)
  expect(await applyHarnessOperation(reference, `reserve:${id}`, operation)).toBe(state)
  expect(mocks.resources).toHaveBeenCalledOnce()
  expect(mocks.resources.mock.calls[0].slice(0, 2)).toEqual([reference, 7])
  expect(mocks.apply.mock.calls.slice(-2).map(([input]) => input.operationId)).toEqual([`reserve:${id}`, `reserve:${id}`])
})

test('Convex argument validation errors become fatal without retrying the mutation', async () => {
  mocks.apply.mockRejectedValue(new Error(
    'Error: [Request ID: fixture] Server Error\nArgumentValidationError: Value does not match validator. Path: .operation',
  ))

  await expect(applyHarnessOperation(reference, 'invalid-arguments', {
    type: 'transition_step', id: 'work', status: 'done',
  })).rejects.toMatchObject({
    name: 'FatalError',
    message: 'Harness operation rejected: invalid operation arguments.',
  })
  expect(mocks.apply).toHaveBeenCalledOnce()
})

test('read and claim returns the post-claim snapshot in one boundary', async () => {
  const claimed = { workflowRunId: reference.workflowRunId, revision: 4, status: 'running' }
  mocks.get.mockResolvedValue({ revision: 3, status: 'running' })
  mocks.apply.mockResolvedValue({ conflict: false, snapshot: claimed })
  expect(await readAndClaimHarnessState(reference)).toEqual({ snapshot: claimed, claimed: true })
  expect(mocks.apply).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
    operationId: 'claim:workflow', expectedRevision: 3, executionGeneration: 0,
    operation: { type: 'claim_execution', workflowRunId: 'workflow', generation: 0 },
  }))
})

test('read and claim leaves terminal and foreign-owned runs unclaimed', async () => {
  mocks.get.mockResolvedValue({ revision: 3, status: 'cancelled' })
  expect(await readAndClaimHarnessState(reference)).toEqual({ snapshot: { revision: 3, status: 'cancelled' }, claimed: false })
  mocks.get.mockResolvedValue({ workflowRunId: 'other', revision: 3, status: 'running' })
  expect((await readAndClaimHarnessState(reference)).claimed).toBe(false)
  expect(mocks.apply).not.toHaveBeenCalled()
})

test('claim keeps its existing behavior for unowned terminal runs', async () => {
  mocks.get.mockResolvedValue({ revision: 3, status: 'cancelled' })
  mocks.apply.mockResolvedValue({ conflict: false, snapshot: {} })
  expect(await claimHarnessState(reference)).toBe(true)
  expect(mocks.apply).toHaveBeenCalledOnce()
})

test('combined admission fences stale generations even when the workflow identity matches', async () => {
  const snapshot = { workflowRunId: reference.workflowRunId, revision: 4, status: 'running', executionGeneration: 2 }
  mocks.get.mockResolvedValue(snapshot)
  expect(await readAndClaimHarnessState({ ...reference, executionGeneration: 1 })).toEqual({ snapshot, claimed: false })
  expect(await claimHarnessState({ ...reference, executionGeneration: 1 })).toBe(false)
  expect(mocks.apply).not.toHaveBeenCalled()
})

test('combined admission claims the current successor generation', async () => {
  const successor = { ...reference, executionGeneration: 2 }
  const snapshot = { revision: 5, status: 'running', executionGeneration: 2, workflowRunId: reference.workflowRunId }
  mocks.get.mockResolvedValue({ ...snapshot, workflowRunId: undefined, revision: 4 })
  mocks.apply.mockResolvedValue({ conflict: false, snapshot })
  expect(await readAndClaimHarnessState(successor)).toEqual({ snapshot, claimed: true })
  expect(mocks.apply).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
    executionGeneration: 2, operation: { type: 'claim_execution', workflowRunId: reference.workflowRunId, generation: 2 },
  }))
})

test('combined admission leaves an authorization-blocked task unclaimed', async () => {
  const snapshot = { revision: 4, status: 'waiting_for_authorization' }
  mocks.get.mockResolvedValue(snapshot)
  expect(await readAndClaimHarnessState(reference)).toEqual({ snapshot, claimed: false })
  expect(mocks.apply).not.toHaveBeenCalled()
})
