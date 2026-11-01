import { beforeEach, expect, test, vi } from 'vitest'
import { waitForHarnessResources, type HarnessResourceWaitPorts } from './resource-waits'

const mocks = vi.hoisted(() => ({ hook: vi.fn(), sleep: vi.fn() }))
vi.mock('workflow', () => ({ createHook: mocks.hook, sleep: mocks.sleep, FatalError: class extends Error {} }))

const input = {
  actorUserId: 'alice', runId: 'run', workflowRunId: 'workflow', token: 'resource:one',
  expectedRevision: 4, reason: 'time' as const, requiredCostMicros: 0,
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(complete => { resolve = complete })
  return { promise, resolve }
}

function harness() {
  const registration = deferred<null | { runId: string }>()
  const disposed = vi.fn()
  const next = vi.fn(() => new Promise<IteratorResult<unknown>>(() => {}))
  mocks.hook.mockReturnValue({
    getConflict: () => registration.promise, [Symbol.asyncIterator]: () => ({ next }), [Symbol.dispose]: disposed,
  })
  mocks.sleep.mockImplementation(() => new Promise(() => {}))
  const publish = vi.fn<HarnessResourceWaitPorts['publish']>().mockResolvedValue('paused')
  const consume = vi.fn<HarnessResourceWaitPorts['consume']>().mockResolvedValue('consumed')
  return { registration, disposed, next, publish, consume }
}

beforeEach(() => vi.resetAllMocks())

test('registers before publication and consumes committed state without requiring a notification', async () => {
  const h = harness()
  const waiting = waitForHarnessResources(input, h)
  expect(h.publish).not.toHaveBeenCalled()
  h.registration.resolve(null)
  expect(await waiting).toBe('consumed')
  expect(h.publish).toHaveBeenCalledExactlyOnceWith(input)
  expect(h.consume).toHaveBeenCalledExactlyOnceWith({
    actorUserId: 'alice', runId: 'run', workflowRunId: 'workflow', token: 'resource:one',
  })
  expect(h.next).not.toHaveBeenCalled()
  expect(mocks.sleep).not.toHaveBeenCalled()
  expect(h.disposed).toHaveBeenCalledOnce()
})

test('a conflicting owner cannot publish or consume a resource request', async () => {
  const h = harness()
  h.registration.resolve({ runId: 'owner' })
  await expect(waitForHarnessResources(input, h)).rejects.toThrow('token is already owned')
  expect(h.publish).not.toHaveBeenCalled()
  expect(h.consume).not.toHaveBeenCalled()
  expect(h.disposed).toHaveBeenCalledOnce()
})

test('lost notifications use fresh durable polls without queuing multiple hook reads', async () => {
  const h = harness()
  h.registration.resolve(null)
  h.consume.mockResolvedValueOnce('pending').mockResolvedValueOnce('pending').mockResolvedValue('consumed')
  mocks.sleep.mockResolvedValue(undefined)
  const before = Date.now()
  expect(await waitForHarnessResources(input, h)).toBe('consumed')
  expect(h.consume).toHaveBeenCalledTimes(3)
  expect(h.next).toHaveBeenCalledOnce()
  expect(mocks.sleep).toHaveBeenCalledTimes(2)
  for (const [deadline] of mocks.sleep.mock.calls) expect(deadline.getTime()).toBeGreaterThanOrEqual(before + 60_000)
  expect(h.disposed).toHaveBeenCalledOnce()
})

test('forged and duplicate notifications never authorize consumption or postpone its poll', async () => {
  const h = harness()
  h.registration.resolve(null)
  h.next.mockResolvedValue({ done: false, value: { granted: true, maxCostMicros: 100_000_000 } })
  h.consume.mockResolvedValueOnce('pending').mockResolvedValueOnce('pending').mockResolvedValueOnce('pending').mockResolvedValue('consumed')
  expect(await waitForHarnessResources(input, h)).toBe('consumed')
  expect(h.consume).toHaveBeenCalledTimes(4)
  expect(h.next).toHaveBeenCalledTimes(3)
  expect(mocks.sleep).toHaveBeenCalledOnce()
  expect(h.consume.mock.calls.every(([reference]) => !('granted' in reference))).toBe(true)
})

test('a closed notification channel still uses authoritative polling and observes cancellation', async () => {
  const h = harness()
  h.registration.resolve(null)
  h.next.mockResolvedValue({ done: true, value: undefined })
  const poll = deferred<void>()
  mocks.sleep.mockReturnValue(poll.promise)
  h.consume.mockResolvedValueOnce('pending').mockImplementationOnce(async () => {
    poll.resolve()
    return 'pending'
  }).mockResolvedValue('inactive')
  expect(await waitForHarnessResources(input, h)).toBe('inactive')
  expect(h.next).toHaveBeenCalledOnce()
  expect(mocks.sleep).toHaveBeenCalledOnce()
  expect(h.disposed).toHaveBeenCalledOnce()
})

test.each(['retry', 'inactive'] as const)('publication %s releases the hook without consuming', async result => {
  const h = harness()
  h.registration.resolve(null)
  h.publish.mockResolvedValue(result)
  expect(await waitForHarnessResources(input, h)).toBe(result)
  expect(h.consume).not.toHaveBeenCalled()
  expect(mocks.sleep).not.toHaveBeenCalled()
  expect(h.disposed).toHaveBeenCalledOnce()
})
