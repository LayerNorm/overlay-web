import { ConvexError } from 'convex/values'
import { beforeEach, expect, test, vi } from 'vitest'
import { FatalError } from 'workflow'
import { applyHarnessOperation } from './state-steps'

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
