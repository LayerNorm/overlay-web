import { beforeEach, expect, test, vi } from 'vitest'
import { attachPersonalHarnessDelivery, finishPersonalHarnessDelivery, writePersonalHarnessFallback } from './personal-delivery-steps'

const mocks = vi.hoisted(() => ({ get: vi.fn(), delivery: vi.fn(), attach: vi.fn(), complete: vi.fn(), fail: vi.fn(), progress: vi.fn(), transition: vi.fn(), write: vi.fn(), release: vi.fn() }))
vi.mock('server-only', () => ({}))
vi.mock('workflow', () => ({ FatalError: class extends Error {}, getWritable: () => ({
  getWriter: () => ({ write: mocks.write, releaseLock: mocks.release }),
}) }))
vi.mock('./ConvexHarnessRepository', () => ({ ConvexHarnessRepository: class { get = mocks.get } }))
vi.mock('@/server/bootstrap', () => ({ getOverlayServerContext: () => ({ appData: { repositories: { conversations: {
  getLatestAgentRun: mocks.delivery, transitionAgentRun: mocks.transition,
} } } }) }))
vi.mock('@/server/conversations/http', () => ({ agentRunService: {
  attachWorkflow: mocks.attach, complete: mocks.complete, fail: mocks.fail, recordProgress: mocks.progress,
} }))
const access = { actorUserId: 'user', runId: 'root', workflowRunId: 'workflow', conversationId: 'conversation', agentRunId: 'delivery',
  workspaceId: 'workspace', principalId: 'principal', authentication: { type: 'session' as const } }
const state = { runId: 'root', workflowRunId: 'workflow', status: 'completed' }
const delivery = { content: 'Result', parts: [{ type: 'text', text: 'Result' }], tokens: { input: 100, output: 10 },
  metrics: { inputTokens: 100, outputTokens: 10, providerCostMicros: 0, toolCallCount: 1, toolSuccessCount: 1, toolFailureCount: 0 } }
const run = { id: 'delivery', userId: 'user', conversationId: 'conversation', harnessRunId: 'root', runner: 'workflow', mode: 'work', status: 'running', workflowRunId: 'workflow' }

test('only the owning running root can stream a notice matching its confirmed rejection', async () => {
  const event = { from: 'provider/model', to: 'provider/fallback', receiptId: 'model:0', reason: 'budget' as const }
  const rejected = { ...state, status: 'running', latestReceipt: { id: 'model:0', modelId: event.from, rejectionReason: event.reason } }
  mocks.get.mockResolvedValue(rejected)
  const notice = await writePersonalHarnessFallback(access, event)
  expect(notice).toContain('switching to')
  expect(mocks.write.mock.calls.map(call => call[0].type)).toEqual(['text-start', 'text-delta', 'text-end'])
  expect(mocks.write).toHaveBeenCalledWith({ type: 'text-delta', id: 'harness-fallback:model:0', text: `${notice}\n\n` })
  expect(mocks.release).toHaveBeenCalledOnce()
  for (const delta of [{ parentRunId: 'parent' }, { workflowRunId: 'other' }, { status: 'cancelled' }, { latestReceipt: undefined }]) {
    mocks.get.mockResolvedValue({ ...rejected, ...delta })
    await expect(writePersonalHarnessFallback(access, event)).rejects.toThrow('authority')
  }
  expect(mocks.write).toHaveBeenCalledTimes(3)
})

beforeEach(() => {
  vi.resetAllMocks()
  mocks.get.mockResolvedValue(state)
  mocks.delivery.mockResolvedValue(run)
  mocks.attach.mockResolvedValue(run)
})

test('only the owning root workflow can attach and complete a personal transcript', async () => {
  await attachPersonalHarnessDelivery(access)
  await finishPersonalHarnessDelivery(access, delivery, { emitWebhook: false, turnId: 'turn' })
  expect(mocks.complete).toHaveBeenCalledExactlyOnceWith({ ...delivery, runId: 'delivery', userId: 'user' })
  mocks.get.mockResolvedValue({ ...state, parentRunId: 'parent' })
  await expect(attachPersonalHarnessDelivery(access)).rejects.toThrow('root delivery authority')
  await expect(finishPersonalHarnessDelivery(access, delivery, { emitWebhook: false, turnId: 'turn' })).rejects.toThrow('root delivery authority')
  expect(mocks.attach).toHaveBeenCalledOnce()
  expect(mocks.complete).toHaveBeenCalledOnce()
})

test('stale delivery ownership and an explicit stop never become successful completion', async () => {
  mocks.delivery.mockResolvedValueOnce({ ...run, workflowRunId: 'other' })
  await expect(finishPersonalHarnessDelivery(access, delivery, { emitWebhook: false, turnId: 'turn' })).rejects.toThrow('ownership changed')
  mocks.delivery.mockResolvedValueOnce({ ...run, status: 'cancelled' })
  await finishPersonalHarnessDelivery(access, delivery, { emitWebhook: false, turnId: 'turn' })
  expect(mocks.complete).not.toHaveBeenCalled()
})

test('a delivery bound to another harness root cannot attach or finish', async () => {
  mocks.delivery.mockResolvedValue({ ...run, harnessRunId: 'other-root' })
  await expect(attachPersonalHarnessDelivery(access)).rejects.toThrow('personal delivery')
  await expect(finishPersonalHarnessDelivery(access, delivery, { emitWebhook: false, turnId: 'turn' })).rejects.toThrow('ownership changed')
  expect(mocks.attach).not.toHaveBeenCalled()
  expect(mocks.complete).not.toHaveBeenCalled()
})

test('failure retains partial text and reports failure instead of completing', async () => {
  mocks.get.mockResolvedValue({ ...state, status: 'failed', terminalReason: 'Budget exhausted.' })
  await finishPersonalHarnessDelivery(access, delivery, { emitWebhook: false, turnId: 'turn' })
  expect(mocks.progress).toHaveBeenCalledWith({ content: 'Result', runId: 'delivery', userId: 'user' })
  expect(mocks.fail).toHaveBeenCalledWith(expect.objectContaining({ errorText: 'Budget exhausted.' }))
  expect(mocks.complete).not.toHaveBeenCalled()
})
