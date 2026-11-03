import { ConvexError } from 'convex/values'
import { beforeEach, expect, test, vi } from 'vitest'
import { FatalError } from 'workflow'
import { HarnessPlanValidationError } from '@overlay/agent-runtime/harness-state'
import { applyHarnessOperation, applyHarnessOperationStep, claimHarnessState, readAndClaimHarnessState } from './state-steps'
import { HARNESS_STEP_VALIDATION } from './step-validation'

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

test.each(Object.values(HARNESS_STEP_VALIDATION))('step validation crosses the durable boundary as data: %s', async message => {
  mocks.apply.mockRejectedValue(new ConvexError({
    code: 'HARNESS_OPERATION_REJECTED',
    message,
  }))

  const operation = { type: 'transition_step' as const, id: 'work', status: 'done' as const, evidenceRefs: ['missing'] }
  const result = await applyHarnessOperationStep(reference, 'invalid-update', operation)
  expect(result).toEqual({ ok: false, code: 'HARNESS_STEP_VALIDATION', message })
  expect(structuredClone(result)).toEqual(result)
  expect(mocks.apply).toHaveBeenCalledOnce()

  const rejection = await applyHarnessOperation(reference, 'invalid-update', operation).catch(error => error)
  expect(rejection).toBeInstanceOf(Error)
  expect(rejection).not.toBeInstanceOf(FatalError)
  expect(rejection.message).toBe(message)
  expect(mocks.resources).not.toHaveBeenCalled()
  expect(mocks.apply).toHaveBeenCalledTimes(2)
})

test('unexpected operation rejections remain fatal', async () => {
  mocks.apply.mockRejectedValue(new ConvexError({ code: 'HARNESS_OPERATION_REJECTED', message: 'The run is terminal.' }))
  await expect(applyHarnessOperation(reference, 'terminal-update', {
    type: 'transition_step', id: 'work', status: 'done',
  })).rejects.toBeInstanceOf(FatalError)
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
    operationId: 'claim:workflow', expectedRevision: 3, operation: { type: 'claim_execution', workflowRunId: 'workflow' },
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
