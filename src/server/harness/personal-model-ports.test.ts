import { beforeEach, expect, test, vi } from 'vitest'
import type { createHarnessModelPorts, PreparedHarnessModel } from './model-ports'
import { createPersonalHarnessModelPorts } from './personal-model-ports'

const mocks = vi.hoisted(() => ({ create: vi.fn(), prepare: vi.fn(), resources: vi.fn(), read: vi.fn() }))
vi.mock('./model-ports', () => ({ createHarnessModelPorts: mocks.create }))
vi.mock('./model-preparation', () => ({ preparePersonalHarnessModel: mocks.prepare }))
vi.mock('./resource-boundary', () => ({ waitForHarnessModelResources: mocks.resources }))
vi.mock('./state-steps', () => ({ readHarnessState: mocks.read }))

const access = { actorUserId: 'user', runId: 'run', workflowRunId: 'workflow', conversationId: 'conversation', agentRunId: 'delivery',
  workspaceId: 'workspace', principalId: 'principal', authentication: { type: 'session' as const } }
const context = { userId: 'user', workspaceId: 'workspace', conversationId: 'conversation', effectiveModelId: 'fixture/model',
  baseUrl: 'https://example.test', memoryEnabled: false, requestedToolIds: [], turnId: 'turn', requestFingerprint: 'request' }
const prepared: PreparedHarnessModel = { model: { modelId: 'fixture/model', credentialOwnerId: 'user' },
  options: { prompt: [] }, contextWindow: null, estimatedCostMicros: 0 }

function preparation() {
  createPersonalHarnessModelPorts({ access, context })
  return (mocks.create.mock.calls[0][0] as Parameters<typeof createHarnessModelPorts>[0]).prepare
}

beforeEach(() => {
  vi.resetAllMocks()
  mocks.prepare.mockResolvedValue(prepared)
  mocks.read.mockResolvedValue({ status: 'running', policy: { resourcePauseVersion: 1 } })
  mocks.resources.mockImplementation((_reference, _cost, read) => read())
})

test.each(['model:0', 'summary:0'] as const)('preparation %s waits outside the step and retries its original request', async receiptId => {
  mocks.prepare.mockResolvedValueOnce({ code: 'HARNESS_TIME_REQUIRED' })
  let grant!: () => void
  mocks.resources.mockImplementationOnce(async (reference, cost, read) => {
    expect(reference).toBe(access)
    expect(cost).toBe(0)
    await new Promise<void>(resolve => { grant = resolve })
    return read()
  })
  const result = preparation()({ modelId: 'fixture/model', receiptId, purpose: receiptId.startsWith('summary') ? 'summary' : 'response',
    options: { prompt: [] } })
  await vi.waitFor(() => expect(grant).toBeTypeOf('function'))
  expect(mocks.prepare).toHaveBeenCalledOnce()
  grant()
  expect(await result).toBe(prepared)
  expect(mocks.prepare).toHaveBeenCalledTimes(2)
  expect(mocks.prepare.mock.calls[1]).toEqual(mocks.prepare.mock.calls[0])
  expect(mocks.read).toHaveBeenCalledExactlyOnceWith(access)
})

test('cancelled preparation cannot retry or return a prepared model', async () => {
  mocks.prepare.mockResolvedValueOnce({ code: 'HARNESS_TIME_REQUIRED' })
  mocks.read.mockResolvedValue({ status: 'cancelled', policy: { resourcePauseVersion: 1 } })
  await expect(preparation()({ modelId: 'fixture/model', receiptId: 'model:0', purpose: 'response', options: { prompt: [] } }))
    .rejects.toThrow('no longer runnable')
  expect(mocks.prepare).toHaveBeenCalledOnce()
})

test('ordinary permission errors do not become time-renewal requests', async () => {
  mocks.prepare.mockRejectedValue(new Error('Permission revoked'))
  await expect(preparation()({ modelId: 'fixture/model', receiptId: 'model:0', purpose: 'response', options: { prompt: [] } }))
    .rejects.toThrow('Permission revoked')
  expect(mocks.resources).not.toHaveBeenCalled()
})

test('access revoked during renewal rejects the retried preparation', async () => {
  mocks.prepare.mockResolvedValueOnce({ code: 'HARNESS_TIME_REQUIRED' })
    .mockRejectedValueOnce(new Error('Permission revoked'))
  await expect(preparation()({ modelId: 'fixture/model', receiptId: 'model:0', purpose: 'response', options: { prompt: [] } }))
    .rejects.toThrow('Permission revoked')
  expect(mocks.prepare).toHaveBeenCalledTimes(2)
  expect(mocks.resources).toHaveBeenCalledOnce()
})
