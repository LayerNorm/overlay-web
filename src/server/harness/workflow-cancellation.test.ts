import { afterEach, expect, test, vi } from 'vitest'
import { cancelHarnessWorkflow } from './workflow-cancellation'

const mocks = vi.hoisted(() => ({ cancel: vi.fn(), status: vi.fn() }))
vi.mock('server-only', () => ({}))
vi.mock('workflow/api', () => ({
  getRun: () => ({ cancel: mocks.cancel, get status() { return mocks.status() } }),
}))
afterEach(() => vi.resetAllMocks())

test('acknowledged cancellation does not need another status request', async () => {
  mocks.cancel.mockResolvedValue(undefined)
  await cancelHarnessWorkflow('workflow')
  expect(mocks.status).not.toHaveBeenCalled()
})

test.each(['cancelled', 'completed', 'failed'])('treats a verified %s workflow as already stopped', async status => {
  mocks.cancel.mockRejectedValue(new Error('Run is terminal'))
  mocks.status.mockResolvedValue(status)
  await expect(cancelHarnessWorkflow('workflow')).resolves.toBeUndefined()
})

test.each(['running', 'pending', undefined])('preserves cancellation failure when status is %s', async status => {
  const error = new Error('Cancellation transport failed')
  mocks.cancel.mockRejectedValue(error)
  mocks.status.mockResolvedValue(status)
  await expect(cancelHarnessWorkflow('workflow')).rejects.toBe(error)
})

test('a failed readback cannot hide the original cancellation failure', async () => {
  const error = new Error('Cancellation transport failed')
  mocks.cancel.mockRejectedValue(error)
  mocks.status.mockRejectedValue(new Error('Readback failed'))
  await expect(cancelHarnessWorkflow('workflow')).rejects.toBe(error)
})
