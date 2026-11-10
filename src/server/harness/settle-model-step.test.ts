import { beforeEach, expect, test, vi } from 'vitest'
import { bindHarnessModelDispatch, createHarnessSnapshot, reserveHarnessModel, type HarnessReceipt } from '@overlay/agent-runtime/harness-state'
import { settleHarnessModelUsage } from './settle-model-step'

const mocks = vi.hoisted(() => ({ read: vi.fn(), resolve: vi.fn(), bill: vi.fn(), batch: vi.fn(), apply: vi.fn() }))
vi.mock('server-only', () => ({}))
vi.mock('./ConvexHarnessRepository', () => ({ ConvexHarnessRepository: class { get = mocks.read } }))
vi.mock('./usage-steps', () => ({ resolveHarnessModelUsage: mocks.resolve }))
vi.mock('./state-steps', () => ({ applyHarnessOperation: mocks.apply, readHarnessState: mocks.read }))
vi.mock('@/server/ai/gateway/gateway-runtime', () => ({ getOrCreateGateway: vi.fn() }))
vi.mock('@/server/ai/gateway/live-model-pricing', () => ({ calculateLanguageModelTokenCostOrNull: vi.fn(async () => 0) }))
vi.mock('@/server/bootstrap', () => ({ getOverlayServerContext: () => ({
  chatUsagePolicy: { recordFinishedUsage: mocks.bill },
  appData: { repositories: { usage: { recordBatch: mocks.batch } } },
}) }))

const reference = { actorUserId: 'user', runId: 'root', workflowRunId: 'workflow' }
const observation = { modelId: 'provider/actual', provider: 'provider', inputTokens: 100, outputTokens: 10,
  reasoningTokens: 2, cacheReadTokens: 50, cacheWriteTokens: 20 }
const receipt: HarnessReceipt = { ...observation, id: 'model:0', contextWindow: 100_000, costMicros: 100, costSource: 'provider' }
const input = { reference, receiptId: 'model:0', observation, contextWindow: 100_000 }
const state = (modelId = 'provider/requested') => ({
  ...bindHarnessModelDispatch(reserveHarnessModel(createHarnessSnapshot({ runId: 'root', goal: 'Work', constraints: [], policy: {
    actorUserId: 'user', workspaceId: 'original-workspace', requiresPlan: false, allowedToolIds: [], maxCostMicros: 0,
    deadlineAt: 10_000, maxDepth: 1, maxParallelChildren: 2,
  } }, 1), 'model:0', 0, 1), 'model:0', { modelId, billingReservationId: null }, 1),
  workflowRunId: 'workflow',
})

beforeEach(() => {
  vi.resetAllMocks()
  mocks.read.mockResolvedValue(state())
  mocks.resolve.mockResolvedValue({ receipt, providerCostUsd: 0.0001, catalogCostUsd: null })
  mocks.bill.mockResolvedValue({ recorded: true, budgetLow: false })
})

test.each([undefined, { kind: 'notebook' as const, noteId: 'note', turnId: 'turn', requestDigest: 'digest' }])(
  'charges the actual cost directly before releasing the dispatch marker for surface %j', async (surface) => {
  mocks.read.mockResolvedValue({ ...state(), policy: { ...state().policy, surface }, status: 'cancelled' })
  expect(await settleHarnessModelUsage(input)).toEqual(receipt)
  expect(mocks.resolve).toHaveBeenCalledWith(expect.objectContaining({ requestedModelId: 'provider/requested' }))
  expect(mocks.bill.mock.calls[0][0]).not.toHaveProperty('reservationId')
  expect(mocks.bill).toHaveBeenCalledWith(expect.objectContaining({ modelId: 'provider/actual',
    userId: 'user', workspaceId: 'original-workspace', requireRecorded: true, countAsRequest: false, providerCostUsd: 0.0001,
    cachedInputTokens: 50, cacheWriteTokens: 20 }))
  expect(mocks.bill.mock.invocationCallOrder[0]).toBeLessThan(mocks.apply.mock.invocationCallOrder[0])
  expect(mocks.apply).toHaveBeenCalledWith(reference, expect.stringMatching(/^harness-model:[a-f0-9]{64}$/), { type: 'record_receipt', receipt })
  mocks.read.mockResolvedValue({ ...state(), modelReservation: undefined, latestReceipt: receipt })
  expect(await settleHarnessModelUsage(input)).toEqual(receipt)
  expect(mocks.bill).toHaveBeenCalledTimes(1)
  expect(mocks.resolve).toHaveBeenCalledTimes(1)
})

test('failed billing and invalid receipts leave the dispatch marker untouched', async () => {
  mocks.bill.mockRejectedValueOnce(new Error('billing unavailable'))
  await expect(settleHarnessModelUsage(input)).rejects.toThrow(/unavailable/)
  mocks.resolve.mockResolvedValueOnce({ receipt: { ...receipt, cacheReadTokens: 101 }, providerCostUsd: 0.0001, catalogCostUsd: null })
  await expect(settleHarnessModelUsage(input)).rejects.toThrow(/Cached tokens/)
  expect(mocks.bill).toHaveBeenCalledTimes(1)
  expect(mocks.apply).not.toHaveBeenCalled()
})

test('rejects mismatched execution ownership or an unbound model hold before charging', async () => {
  for (const value of [null, { ...state(), workflowRunId: 'other' }, { ...state(), modelReservation: { id: 'model:0', maxCostMicros: 0 } }]) {
    mocks.read.mockResolvedValueOnce(value)
    await expect(settleHarnessModelUsage(input)).rejects.toThrow()
  }
  expect(mocks.resolve).not.toHaveBeenCalled()
  expect(mocks.bill).not.toHaveBeenCalled()
})

test('BYOK writes token audit with unknown external cost but no Overlay charge', async () => {
  mocks.read.mockResolvedValue(state('byok/connection/model'))
  const external: HarnessReceipt = { ...receipt, costMicros: 0, costSource: 'external', externalCostMicros: null }
  mocks.resolve.mockResolvedValue({ receipt: external, providerCostUsd: null, catalogCostUsd: null })
  await settleHarnessModelUsage(input)
  expect(mocks.bill).not.toHaveBeenCalled()
  expect(mocks.batch).toHaveBeenCalledWith(expect.objectContaining({ userId: 'user', workspaceId: 'original-workspace',
    events: [expect.objectContaining({ countAsRequest: false, costCents: 0, modelId: 'byok/connection/model', inputTokens: 100,
      metadata: expect.objectContaining({ externalCostMicros: null, costSource: 'external' }) })] }))
  mocks.batch.mockRejectedValueOnce(new Error('audit unavailable'))
  await expect(settleHarnessModelUsage(input)).rejects.toThrow(/unavailable/)
  expect(mocks.apply).toHaveBeenCalledTimes(1)
})

test('catalog settlement charges the catalog cost directly without fabricating an exact provider receipt', async () => {
  mocks.resolve.mockResolvedValue({ receipt: { ...receipt, costSource: 'catalog' }, providerCostUsd: null, catalogCostUsd: 0.0001 })
  mocks.bill.mockResolvedValue({ recorded: true, budgetLow: false })
  await settleHarnessModelUsage(input)
  expect(mocks.bill.mock.calls[0][0]).toMatchObject({ catalogCostUsd: 0.0001 })
  expect(mocks.bill.mock.calls[0][0]).not.toHaveProperty('providerCostUsd')
})
