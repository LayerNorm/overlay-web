import { beforeEach, expect, test, vi } from 'vitest'
import { createHarnessSnapshot, type HarnessSnapshot } from '@overlay/agent-runtime/harness-state'
import { waitForHarnessHumanReply, waitForHarnessModelResources } from './resource-boundary'

const mocks = vi.hoisted(() => ({ wait: vi.fn(), sleep: vi.fn() }))
vi.mock('server-only', () => ({}))
vi.mock('workflow', () => ({ FatalError: class extends Error {}, sleep: mocks.sleep }))
vi.mock('./resource-waits', () => ({ waitForHarnessResources: mocks.wait }))

const reference = { actorUserId: 'alice', runId: 'run', workflowRunId: 'workflow' }
let state: HarnessSnapshot
const read = vi.fn(async () => state)
const resources = { publish: vi.fn(), consume: vi.fn(), token: vi.fn(async ({ expectedRevision }: { expectedRevision: number }) => `resource:${expectedRevision}`) }
const boundary = (cost = 0) => waitForHarnessModelResources(reference, cost, read, resources)

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}

beforeEach(() => {
  vi.clearAllMocks()
  state = { ...createHarnessSnapshot({ runId: 'run', goal: 'Build a film', constraints: [], policy: {
    actorUserId: 'alice', allowedToolIds: [], requiresPlan: false, maxCostMicros: 10,
    deadlineAt: Date.now() + 60_000, maxDepth: 0, maxParallelChildren: 0, resourcePauseVersion: 1,
  } }, Date.now()), workflowRunId: 'workflow' }
})

test.each(['input', 'approval', 'stuck'] as const)('time renewal preserves a pending %s reply and its unknown holds', async kind => {
  state.status = kind === 'approval' ? 'waiting_for_approval' : 'waiting_for_input'
  const blocker = { kind, question: 'Continue the film?' }
  state.blocker = blocker
  state.policy.deadlineAt = 0
  state.policy.maxCostMicros = 0
  state.usage.costMicros = 1
  const hold = { id: 'unknown-model', maxCostMicros: 5 }
  state.modelReservation = hold
  const reply = deferred<{ approved: boolean }>()
  const grant = deferred<void>()
  mocks.wait.mockImplementationOnce(async input => {
    expect(input).toMatchObject({ reason: 'time', requiredCostMicros: 0 })
    await grant.promise
    state.policy.deadlineAt = Date.now() + 60_000
    return 'consumed'
  })
  let delivered = false
  const result = waitForHarnessHumanReply(reference, reply.promise, kind === 'approval' ? 'approval' : 'input', read, resources)
    .then(value => { delivered = true; return value })
  await vi.waitFor(() => expect(mocks.wait).toHaveBeenCalledOnce())
  reply.resolve({ approved: false })
  await Promise.resolve()
  expect(delivered).toBe(false)
  grant.resolve()
  expect(await result).toEqual({ approved: false })
  expect(state.blocker).toBe(blocker)
  expect(state.modelReservation).toBe(hold)
  expect(state.policy.maxCostMicros).toBe(0)
  expect(state.usage.costMicros).toBe(1)
  expect(mocks.wait).toHaveBeenCalledOnce()
})

test('the same unanswered human hook survives repeated deadline renewals', async () => {
  state.status = 'waiting_for_input'
  state.blocker = { kind: 'input', question: 'Which film?' }
  const reply = deferred<string>()
  mocks.sleep.mockImplementation(async () => { state.policy.deadlineAt = 0 })
  let grants = 0
  mocks.wait.mockImplementation(async () => {
    state.revision += 2
    state.policy.deadlineAt = Date.now() + 60_000
    if (++grants === 2) reply.resolve('The original answer')
    return 'consumed'
  })
  expect(await waitForHarnessHumanReply(reference, reply.promise, 'input', read, resources)).toBe('The original answer')
  expect(mocks.sleep).toHaveBeenCalledTimes(2)
  expect(resources.token.mock.calls.map(([input]) => input.expectedRevision)).toEqual([0, 2])
})

test('cancellation during time renewal does not fabricate a human response', async () => {
  state.status = 'waiting_for_input'
  state.blocker = { kind: 'input', question: 'Which film?' }
  state.policy.deadlineAt = 0
  mocks.wait.mockImplementationOnce(async () => { state.status = 'cancelled'; return 'inactive' })
  expect(await waitForHarnessHumanReply(reference, new Promise(() => {}), 'input', read, resources)).toBeNull()
})

test('a different ordinary wait cannot consume the original reply', async () => {
  state.status = 'waiting_for_input'
  state.blocker = { kind: 'input', question: 'Which film?' }
  state.policy.deadlineAt = 0
  await expect(waitForHarnessHumanReply(reference, Promise.resolve({ approved: true }), 'approval', read, resources))
    .rejects.toThrow('HARNESS_HUMAN_WAIT_CHANGED')
  expect(mocks.wait).not.toHaveBeenCalled()
})

test('does not create waits for unversioned or already-authorized work', async () => {
  expect(await boundary(10)).toBe(state)
  state.policy.resourcePauseVersion = undefined
  state.policy.deadlineAt = 0
  expect(await boundary(100)).toBe(state)
  expect(mocks.wait).not.toHaveBeenCalled()
})

test('rereads each grant and requests time and spending separately without changing holds itself', async () => {
  state.policy.deadlineAt = 0
  mocks.wait.mockImplementationOnce(async input => {
    expect(input).toMatchObject({ ...reference, expectedRevision: 0, reason: 'time', requiredCostMicros: 11 })
    state = { ...state, revision: 2, policy: { ...state.policy, deadlineAt: Date.now() + 60_000 } }
    return 'consumed'
  }).mockImplementationOnce(async input => {
    expect(input).toMatchObject({ expectedRevision: 2, token: 'resource:2', reason: 'model_spend', requiredCostMicros: 11 })
    state = { ...state, revision: 4, policy: { ...state.policy, maxCostMicros: 11 } }
    return 'consumed'
  })
  expect(await boundary(11)).toBe(state)
  expect(mocks.wait).toHaveBeenCalledTimes(2)
  expect(read).toHaveBeenCalledTimes(3)
})

test('a contended publication backs off and derives a token from the new revision', async () => {
  state.policy.deadlineAt = 0
  mocks.wait.mockImplementationOnce(async () => { state.revision++; return 'retry' })
    .mockImplementationOnce(async () => { state.policy.deadlineAt = Date.now() + 60_000; return 'consumed' })
  await boundary()
  expect(resources.token.mock.calls.map(([input]) => input.expectedRevision)).toEqual([0, 1])
  expect(mocks.sleep).toHaveBeenCalledExactlyOnceWith('1s')
})

test('reattaches an existing request without guessing its original publication revision', async () => {
  state.status = 'waiting_for_resources'
  state.resourceRequestToken = 'existing'
  state.revision = 20
  mocks.wait.mockImplementationOnce(async () => {
    state = { ...state, status: 'waiting_for_input', resourceRequestToken: undefined,
      blocker: { kind: 'input', question: 'Which film?' } }
    return 'consumed'
  })
  expect((await boundary()).blocker?.question).toBe('Which film?')
  expect(mocks.wait.mock.calls[0][0]).toEqual({ ...reference, token: 'existing' })
  expect(resources.token).not.toHaveBeenCalled()
})

test('cancellation while waiting never authorizes a model call or clears an unknown hold', async () => {
  state.policy.deadlineAt = 0
  state.modelReservation = { id: 'unknown', maxCostMicros: 3 }
  mocks.wait.mockImplementationOnce(async () => { state.status = 'cancelled'; return 'inactive' })
  expect((await boundary()).status).toBe('cancelled')
  expect(state.modelReservation).toEqual({ id: 'unknown', maxCostMicros: 3 })
})

test('rejects foreign or unsupported versioned scopes and invalid estimates before publication', async () => {
  const initial = state
  for (const patch of [
    { workflowRunId: 'other' }, { runId: 'other' }, { parentRunId: 'parent' },
    { policy: { ...initial.policy, actorUserId: 'other' } },
    { policy: { ...initial.policy, maxDepth: 1 } },
  ]) {
    state = { ...initial, ...patch }
    await expect(boundary()).rejects.toThrow('NOT_OWNED')
  }
  state = initial
  await expect(boundary(-1)).rejects.toThrow('nonnegative')
  expect(mocks.wait).not.toHaveBeenCalled()
})
