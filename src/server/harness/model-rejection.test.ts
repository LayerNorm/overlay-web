import { beforeEach, expect, test, vi } from 'vitest'
import { GatewayModelNotFoundError, GatewayRateLimitError } from '@ai-sdk/gateway'
import { isConfirmedHarnessModelRejection, recordHarnessModelRejection } from './model-rejection'
import type { HarnessModelReference } from './secure-model'

const mocks = vi.hoisted(() => ({ read: vi.fn(), apply: vi.fn(), release: vi.fn() }))
vi.mock('server-only', () => ({}))
vi.mock('./state-steps', () => ({ readHarnessState: mocks.read, applyHarnessOperation: mocks.apply }))
vi.mock('@/server/billing/billing-runtime', () => ({ releaseProviderBudgetReservation: mocks.release }))
const reference: HarnessModelReference = { modelId: 'provider/model', credentialOwnerId: 'user', allowLowBalanceFallback: false,
  personal: { access: { actorUserId: 'user', runId: 'root', workflowRunId: 'workflow', conversationId: 'conversation', agentRunId: 'delivery',
    workspaceId: 'workspace', principalId: 'principal', authentication: { type: 'session' } },
  receiptId: 'model:0', memoryEnabled: false, requestFingerprint: 'request', inputTokenBudget: 100, maxOutputTokens: 100, contextWindow: 1_000 } }
const hold = { id: 'model:0', maxCostMicros: 100 }
const state = { workflowRunId: 'workflow', modelReservation: hold }

beforeEach(() => { vi.resetAllMocks(); mocks.read.mockResolvedValue(state) })

test('only a typed model-not-found rejection without a generation is confirmed', () => {
  expect(isConfirmedHarnessModelRejection(new GatewayModelNotFoundError())).toBe(true)
  for (const error of [new GatewayModelNotFoundError({ generationId: 'generation' }), new GatewayModelNotFoundError({ statusCode: 500 }),
    new GatewayRateLimitError(), new Error('timeout'), { name: 'GatewayModelNotFoundError', statusCode: 404 }]) {
    expect(isConfirmedHarnessModelRejection(error)).toBe(false)
  }
})

test('budget refusal clears only an unbound hold with a zero-cost rejection receipt', async () => {
  await recordHarnessModelRejection(reference, 'budget')
  expect(mocks.release).not.toHaveBeenCalled()
  expect(mocks.apply).toHaveBeenCalledWith(reference.personal!.access, 'rejected:model:0', {
    type: 'record_receipt', receipt: expect.objectContaining({ id: 'model:0', rejectionReason: 'budget', costMicros: 0, inputTokens: 0, outputTokens: 0 }),
  })
  mocks.read.mockResolvedValue({ ...state, modelReservation: { ...hold, dispatch: { modelId: 'provider/model', billingReservationId: 'billing' } } })
  await expect(recordHarnessModelRejection(reference, 'budget')).rejects.toThrow('matching dispatch')
  expect(mocks.apply).toHaveBeenCalledOnce()
})

test('confirmed provider rejection releases its account reservation before recording; failed release preserves the hold', async () => {
  mocks.read.mockResolvedValue({ ...state, modelReservation: { ...hold, dispatch: { modelId: 'provider/model', billingReservationId: 'billing' } } })
  mocks.release.mockRejectedValueOnce(new Error('storage unavailable'))
  await expect(recordHarnessModelRejection(reference, 'model_unavailable')).rejects.toThrow('storage unavailable')
  expect(mocks.apply).not.toHaveBeenCalled()
  await recordHarnessModelRejection(reference, 'model_unavailable')
  expect(mocks.release).toHaveBeenLastCalledWith(expect.objectContaining({ userId: 'user', reservationId: 'billing' }))
  expect(mocks.release.mock.invocationCallOrder[1]).toBeLessThan(mocks.apply.mock.invocationCallOrder[0])
})

test('foreign ownership and external models cannot clear a dispatch', async () => {
  mocks.read.mockResolvedValue({ ...state, workflowRunId: 'other' })
  await expect(recordHarnessModelRejection(reference, 'budget')).rejects.toThrow('owner')
  await expect(recordHarnessModelRejection({ ...reference, modelId: 'byok/key/model' }, 'budget')).rejects.toThrow('external')
  expect(mocks.release).not.toHaveBeenCalled()
  expect(mocks.apply).not.toHaveBeenCalled()
})

test('capacity rejection releases only a matching free-router dispatch with a zero receipt', async () => {
  const free = { ...reference, modelId: 'openrouter/free' }
  mocks.read.mockResolvedValue({ ...state, modelReservation: { ...hold, dispatch: { modelId: free.modelId, billingReservationId: 'billing' } } })
  await recordHarnessModelRejection(free, 'route_capacity')
  expect(mocks.apply).toHaveBeenCalledWith(free.personal!.access, 'rejected:model:0', expect.objectContaining({
    receipt: expect.objectContaining({ rejectionReason: 'route_capacity', provider: 'overlay-free-router', inputTokens: 0, outputTokens: 0, costMicros: 0 }),
  }))
  expect(mocks.release).toHaveBeenCalledOnce()
  await expect(recordHarnessModelRejection(reference, 'route_capacity')).rejects.toThrow('Only the free router')
  mocks.read.mockResolvedValue(state)
  await expect(recordHarnessModelRejection(free, 'route_capacity')).rejects.toThrow('matching dispatch')
  expect(mocks.apply).toHaveBeenCalledOnce()
})

test('native confirmed rejection retains the same receipt and billing safeguards', async () => {
  const native = {
    access: { actorUserId: 'user', runId: 'workspace:delivery', workflowRunId: 'workflow', workspaceId: 'workspace',
      principalId: 'human-principal', agentId: 'agent', agentPrincipalId: 'agent-principal', conversationId: 'room',
      agentRunId: 'delivery', userMessageId: 'question', assistantMessageId: 'answer', turnId: 'turn' },
    receiptId: 'model:0', memoryEnabled: false, sharedRoom: true, requestFingerprint: 'request',
    inputTokenBudget: 100, maxOutputTokens: 100, contextWindow: 1_000,
  }
  const free: HarnessModelReference = { modelId: 'openrouter/free', credentialOwnerId: 'user', allowLowBalanceFallback: false, native }
  mocks.read.mockResolvedValue({ ...state, modelReservation: { ...hold,
    dispatch: { modelId: free.modelId, billingReservationId: 'billing' },
  } })
  await recordHarnessModelRejection(free, 'route_capacity')
  expect(mocks.apply).toHaveBeenCalledExactlyOnceWith(native.access, 'rejected:model:0', expect.objectContaining({
    receipt: expect.objectContaining({ rejectionReason: 'route_capacity', costMicros: 0, inputTokens: 0, outputTokens: 0 }),
  }))
  await expect(recordHarnessModelRejection({ ...free, personal: reference.personal }, 'route_capacity')).rejects.toThrow(/ambiguous/)
  await expect(recordHarnessModelRejection({ ...free, modelId: 'byok/key/model' }, 'route_capacity')).rejects.toThrow(/external/)
  expect(mocks.release).toHaveBeenCalledOnce()
})
