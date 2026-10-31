import { ConvexError } from 'convex/values'
import { beforeEach, expect, test, vi } from 'vitest'
import { FatalError } from 'workflow'
import { HarnessPlanValidationError } from '@overlay/agent-runtime/harness-state'
import { applyHarnessOperation, applyHarnessOperationStep } from './state-steps'

const mocks = vi.hoisted(() => ({ get: vi.fn(), apply: vi.fn() }))

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
