import { beforeEach, expect, test, vi } from 'vitest'
import { createHarnessExecutionPorts } from './execution-ports'

const mocks = vi.hoisted(() => ({ claim: vi.fn(), admit: vi.fn() }))
vi.mock('./state-ports', () => ({ createHarnessStatePorts: () => ({ claim: mocks.claim }) }))
vi.mock('./request-usage-step', () => ({ admitHarnessRequestUsage: mocks.admit }))

const reference = { actorUserId: 'actor', runId: 'run', workflowRunId: 'workflow' }
const authorize = vi.fn()
const model = { prepareModel: vi.fn(), recordModelStep: vi.fn(), recoverModelFailure: vi.fn() }
const surface = {
  recordToolResult: vi.fn(), delegate: vi.fn(), readChild: vi.fn(), waitForChildren: vi.fn(),
  waitForInput: vi.fn(), waitForApproval: vi.fn(),
}
const create = () => createHarnessExecutionPorts({ reference, modelId: 'fixture/model', authorize, model, surface })

beforeEach(() => {
  vi.resetAllMocks()
  mocks.claim.mockResolvedValue(true)
  authorize.mockResolvedValue(undefined)
})

test('a surface authorizes the claimed execution before request accounting', async () => {
  const ports = create()
  expect(await ports.claim()).toBe(true)
  expect(authorize).toHaveBeenCalledExactlyOnceWith()
  expect(mocks.admit).toHaveBeenCalledExactlyOnceWith(reference, 'fixture/model')
  expect(mocks.claim.mock.invocationCallOrder[0]).toBeLessThan(authorize.mock.invocationCallOrder[0])
  expect(authorize.mock.invocationCallOrder[0]).toBeLessThan(mocks.admit.mock.invocationCallOrder[0])
  expect(ports.prepareModel).toBe(model.prepareModel)
  expect(ports.waitForInput).toBe(surface.waitForInput)
  await ports.authorizeTool('read_file')
  expect(authorize).toHaveBeenLastCalledWith('read_file')
})

test('a losing workflow cannot authorize or consume a request allowance', async () => {
  mocks.claim.mockResolvedValue(false)
  expect(await create().claim()).toBe(false)
  expect(authorize).not.toHaveBeenCalled()
  expect(mocks.admit).not.toHaveBeenCalled()
})

test('revoked surface authorization fails closed before accounting or tools', async () => {
  authorize.mockRejectedValue(new Error('Access revoked'))
  const ports = create()
  await expect(ports.claim()).rejects.toThrow('Access revoked')
  expect(mocks.admit).not.toHaveBeenCalled()
  await expect(ports.authorizeTool('send_message')).rejects.toThrow('Access revoked')
})
