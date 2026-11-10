import { beforeEach, expect, test, vi } from 'vitest'
import { GatewayModelNotFoundError, GatewayRateLimitError } from '@ai-sdk/gateway'
import { isConfirmedHarnessModelRejection, recordHarnessModelRejection } from './model-rejection'
import type { HarnessModelReference } from './secure-model'

const mocks = vi.hoisted(() => ({ read: vi.fn(), apply: vi.fn() }))
vi.mock('server-only', () => ({}))
vi.mock('./state-steps', () => ({ readHarnessState: mocks.read, applyHarnessOperation: mocks.apply }))
const reference: HarnessModelReference = { modelId: 'provider/model', credentialOwnerId: 'user',
  personal: { access: { actorUserId: 'user', runId: 'root', workflowRunId: 'workflow', conversationId: 'conversation', agentRunId: 'delivery',
    workspaceId: 'workspace', principalId: 'principal', authentication: { type: 'session' } },
  receiptId: 'model:0', memoryEnabled: false, requestFingerprint: 'request', maxOutputTokens: 100, contextWindow: 1_000 } }
const marker = { id: 'model:0', maxCostMicros: 0, dispatch: { modelId: 'provider/model', billingReservationId: null } }
const state = { workflowRunId: 'workflow', modelReservation: marker }

beforeEach(() => { vi.resetAllMocks(); mocks.read.mockResolvedValue(state) })

test('only a typed model-not-found rejection without a generation is confirmed', () => {
  expect(isConfirmedHarnessModelRejection(new GatewayModelNotFoundError())).toBe(true)
  for (const error of [new GatewayModelNotFoundError({ generationId: 'generation' }), new GatewayModelNotFoundError({ statusCode: 500 }),
    new GatewayRateLimitError(), new Error('timeout'), { name: 'GatewayModelNotFoundError', statusCode: 404 }]) {
    expect(isConfirmedHarnessModelRejection(error)).toBe(false)
  }
})

test('a confirmed provider rejection records a zero-cost receipt for its bound dispatch', async () => {
  await recordHarnessModelRejection(reference, 'model_unavailable')
  expect(mocks.apply).toHaveBeenCalledWith(reference.personal!.access, 'rejected:model:0', {
    type: 'record_receipt', receipt: expect.objectContaining({ id: 'model:0', provider: 'gateway',
      rejectionReason: 'model_unavailable', costMicros: 0, inputTokens: 0, outputTokens: 0 }),
  })
  mocks.read.mockResolvedValue({ ...state, modelReservation: { id: 'model:0', maxCostMicros: 0 } })
  await expect(recordHarnessModelRejection(reference, 'model_unavailable')).rejects.toThrow('matching dispatch')
  expect(mocks.apply).toHaveBeenCalledOnce()
})

test('foreign ownership and external models cannot clear a dispatch', async () => {
  mocks.read.mockResolvedValue({ ...state, workflowRunId: 'other' })
  await expect(recordHarnessModelRejection(reference, 'model_unavailable')).rejects.toThrow('owner')
  await expect(recordHarnessModelRejection({ ...reference, modelId: 'byok/key/model' }, 'model_unavailable')).rejects.toThrow('external')
  expect(mocks.apply).not.toHaveBeenCalled()
})
