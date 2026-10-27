import { beforeEach, expect, test, vi } from 'vitest'
import { MockLanguageModelV4 } from 'ai/test'
import { OverlayFreeRouteBusyError } from '@/server/ai/gateway/overlay-free-router-errors'
import type { HarnessModelReference } from './secure-model'
import { secureModelDoGenerate, secureModelDoStream } from './secure-model-runtime'

const mocks = vi.hoisted(() => ({ model: vi.fn(), record: vi.fn(), confirmed: vi.fn() }))
vi.mock('@/server/ai/model-runtime', () => ({ getLanguageModel: mocks.model }))
vi.mock('./model-rejection', () => ({ recordHarnessModelRejection: mocks.record, isConfirmedHarnessModelRejection: mocks.confirmed }))

const reference: HarnessModelReference = { modelId: 'openrouter/free', credentialOwnerId: 'user', personal: {
  access: { actorUserId: 'user', runId: 'run', workflowRunId: 'workflow', conversationId: 'conversation', agentRunId: 'delivery',
    workspaceId: 'workspace', principalId: 'principal', authentication: { type: 'session' } },
  receiptId: 'model:0', memoryEnabled: false, requestFingerprint: 'request', inputTokenBudget: 100, maxOutputTokens: 100, contextWindow: null,
} }

beforeEach(() => { vi.resetAllMocks(); mocks.confirmed.mockReturnValue(false) })

test.each([secureModelDoStream, secureModelDoGenerate])('only the typed pre-inference busy result creates a capacity receipt', async invoke => {
  let failure: Error = new OverlayFreeRouteBusyError()
  const dispatch = async () => { throw failure }
  mocks.model.mockResolvedValue(new MockLanguageModelV4({ doStream: dispatch, doGenerate: dispatch }))
  await expect(invoke(reference, { prompt: [] })).rejects.toBe(failure)
  expect(mocks.record).toHaveBeenCalledExactlyOnceWith(reference, 'route_capacity')
  failure = new Error('overlay_free_route_busy')
  await expect(invoke(reference, { prompt: [] })).rejects.toBe(failure)
  expect(mocks.record).toHaveBeenCalledOnce()
  failure = new OverlayFreeRouteBusyError()
  mocks.record.mockRejectedValueOnce(new Error('receipt storage failed'))
  await expect(invoke(reference, { prompt: [] })).rejects.toThrow('receipt storage failed')
})
