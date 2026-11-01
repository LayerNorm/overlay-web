import { beforeEach, expect, test, vi } from 'vitest'
import { createHarnessSnapshot, type HarnessSnapshot } from '@overlay/agent-runtime/harness-state'
import { consumeHarnessResourceWait, createHarnessResourceToken, publishHarnessResourceWait } from './resource-wait-steps'

const mocks = vi.hoisted(() => ({ get: vi.fn(), pause: vi.fn(), consume: vi.fn() }))
vi.mock('server-only', () => ({}))
vi.mock('./ConvexHarnessRepository', () => ({ ConvexHarnessRepository: class {
  get = mocks.get; pauseForResources = mocks.pause; consumeResourceGrant = mocks.consume
} }))

const input = {
  actorUserId: 'alice', runId: 'run', workflowRunId: 'workflow', token: 'resource:one',
  expectedRevision: 4, reason: 'time' as const, requiredCostMicros: 0,
}
let state: HarnessSnapshot

test('resource tokens are deterministic, bounded and bound to run, workflow and revision', async () => {
  const identity = { runId: 'r'.repeat(256), workflowRunId: 'w'.repeat(256), expectedRevision: 1 }
  const token = await createHarnessResourceToken(identity)
  expect(await createHarnessResourceToken(identity)).toBe(token)
  expect(token.length).toBeLessThanOrEqual(256)
  for (const patch of [{ runId: 'other' }, { workflowRunId: 'other' }, { expectedRevision: 2 }]) {
    expect(await createHarnessResourceToken({ ...identity, ...patch })).not.toBe(token)
  }
})

beforeEach(() => {
  vi.resetAllMocks()
  state = { ...createHarnessSnapshot({ runId: 'run', goal: 'Build a film', constraints: [], policy: {
    actorUserId: 'alice', allowedToolIds: [], requiresPlan: false, maxCostMicros: 100,
    deadlineAt: Date.now() + 60_000, maxDepth: 0, maxParallelChildren: 0, resourcePauseVersion: 1,
  } }, Date.now()), workflowRunId: 'workflow' }
  mocks.get.mockImplementation(async () => state)
  mocks.pause.mockResolvedValue({ state: 'pending' })
  mocks.consume.mockResolvedValue({ status: 'pending', reason: 'awaiting_receipt' })
})

test('publication and consumption delegate authorization atomically and never settle unknown holds', async () => {
  expect(await publishHarnessResourceWait(input)).toBe('paused')
  expect(mocks.pause).toHaveBeenCalledExactlyOnceWith(input)
  state = { ...state, status: 'waiting_for_resources', resourceRequestToken: input.token,
    modelReservation: { id: 'model:0', maxCostMicros: 100 } }
  expect(await consumeHarnessResourceWait(input)).toBe('pending')
  expect(mocks.consume).toHaveBeenCalledExactlyOnceWith(input)
  expect(state.modelReservation).toEqual({ id: 'model:0', maxCostMicros: 100 })
  state.modelReservation = undefined
  mocks.consume.mockResolvedValue({ status: 'consumed', request: { wakePending: false } })
  expect(await consumeHarnessResourceWait(input)).toBe('consumed')
})

test.each(['HARNESS_STATE_CONFLICT', 'HARNESS_RESOURCE_NOT_EXHAUSTED'])('publication %s asks the caller to reread instead of inventing a pause', async code => {
  mocks.pause.mockRejectedValue(new Error(code))
  expect(await publishHarnessResourceWait(input)).toBe('retry')
  expect(mocks.consume).not.toHaveBeenCalled()
})

test('foreign workflow, actor, request and unversioned callers cannot consume or publish', async () => {
  const valid = state
  for (const patch of [
    { workflowRunId: 'other' }, { policy: { ...state.policy, actorUserId: 'other' } },
    { policy: { ...state.policy, resourcePauseVersion: undefined } }, { parentRunId: 'parent' },
    { status: 'waiting_for_resources' as const, resourceRequestToken: 'other-token' },
  ]) {
    state = { ...valid, ...patch }
    await expect(publishHarnessResourceWait(input)).rejects.toThrow('HARNESS_RESOURCE_WAIT_')
    await expect(consumeHarnessResourceWait(input)).rejects.toThrow('HARNESS_RESOURCE_WAIT_')
  }
  expect(mocks.pause).not.toHaveBeenCalled()
  expect(mocks.consume).not.toHaveBeenCalled()
})

test('terminal state and cancellation racing consumption never resume the task', async () => {
  state.status = 'cancelled'
  expect(await publishHarnessResourceWait(input)).toBe('inactive')
  expect(await consumeHarnessResourceWait(input)).toBe('inactive')
  expect(mocks.pause).not.toHaveBeenCalled()
  expect(mocks.consume).not.toHaveBeenCalled()
  state.status = 'running'
  mocks.consume.mockImplementation(async () => {
    state.status = 'cancelled'
    throw new Error('HARNESS_RESOURCE_SOURCE_DENIED')
  })
  expect(await consumeHarnessResourceWait(input)).toBe('inactive')
})

test('revoked authority and ambiguous transport errors are not reported as grants or contention', async () => {
  for (const message of ['HARNESS_RESOURCE_MEMBERSHIP_DENIED', 'invalid response after commit']) {
    mocks.pause.mockRejectedValue(new Error(message))
    mocks.consume.mockRejectedValue(new Error(message))
    await expect(publishHarnessResourceWait(input)).rejects.toThrow(message)
    await expect(consumeHarnessResourceWait(input)).rejects.toThrow(message)
  }
})
