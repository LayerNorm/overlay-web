import { beforeEach, expect, test, vi } from 'vitest'
import { MockLanguageModelV4 } from 'ai/test'
import { OverlayFreeRouteBusyError, OverlayFreeRouteInterruptedError } from '@/server/ai/gateway/overlay-free-router-errors'
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

const nativeReference: HarnessModelReference = { modelId: 'openrouter/free', credentialOwnerId: 'user', native: {
  access: { actorUserId: 'user', runId: 'workspace:delivery', workflowRunId: 'workflow', workspaceId: 'workspace',
    principalId: 'human-principal', agentId: 'agent', agentPrincipalId: 'agent-principal', conversationId: 'room',
    agentRunId: 'delivery', userMessageId: 'question', assistantMessageId: 'answer', turnId: 'turn' },
  receiptId: 'model:0', memoryEnabled: false, sharedRoom: true, requestFingerprint: 'request',
  inputTokenBudget: 100, maxOutputTokens: 100, contextWindow: null,
} }

beforeEach(() => { vi.resetAllMocks(); mocks.confirmed.mockReturnValue(false) })

test('generated results separate tagged reasoning without changing provider accounting', async () => {
  const usage = { inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
    outputTokens: { total: 5, text: 5, reasoning: 0 } }
  const provider = new MockLanguageModelV4({ doGenerate: async () => ({
    content: [{ type: 'text', text: '<think>Private planning</think>Final result' }],
    finishReason: { unified: 'stop', raw: 'stop' }, usage, warnings: [],
  }) })
  mocks.model.mockResolvedValue(provider)
  const result = await secureModelDoGenerate(reference, { prompt: [] })
  expect(result.content).toEqual([{ type: 'reasoning', text: 'Private planning' }, { type: 'text', text: 'Final result' }])
  expect(result.usage).toEqual(usage)
  expect(provider.doGenerateCalls).toHaveLength(1)
})

test.each([
  [secureModelDoStream, reference], [secureModelDoGenerate, reference],
  [secureModelDoStream, nativeReference], [secureModelDoGenerate, nativeReference],
] as const)('only the typed free-router busy result creates a capacity receipt', async (invoke, dispatchReference) => {
  let failure: Error = new OverlayFreeRouteBusyError()
  const dispatch = async () => { throw failure }
  mocks.model.mockResolvedValue(new MockLanguageModelV4({ doStream: dispatch, doGenerate: dispatch }))
  await expect(invoke(dispatchReference, { prompt: [] })).rejects.toBe(failure)
  expect(mocks.record).toHaveBeenCalledExactlyOnceWith(dispatchReference, 'route_capacity')
  failure = new Error('overlay_free_route_busy')
  await expect(invoke(dispatchReference, { prompt: [] })).rejects.toBe(failure)
  expect(mocks.record).toHaveBeenCalledOnce()
  failure = new OverlayFreeRouteBusyError()
  mocks.record.mockRejectedValueOnce(new Error('receipt storage failed'))
  await expect(invoke(dispatchReference, { prompt: [] })).rejects.toThrow('receipt storage failed')
})

test.each([reference, nativeReference])('records an async free-route interruption before rethrowing it', async dispatchReference => {
  const interruption = new OverlayFreeRouteInterruptedError()
  mocks.model.mockResolvedValue(new MockLanguageModelV4({
    doStream: async () => ({
      stream: new ReadableStream({ start: controller => controller.error(interruption) }),
    }),
  }))

  const result = await secureModelDoStream(dispatchReference, { prompt: [] })
  await expect(result.stream.getReader().read()).rejects.toBe(interruption)
  expect(mocks.record).toHaveBeenCalledExactlyOnceWith(dispatchReference, 'route_interrupted')
})

test('BYOK stream interruptions do not create Harness rejection receipts', async () => {
  const interruption = new OverlayFreeRouteInterruptedError()
  const byok = { ...reference, modelId: 'byok/connection/model' }
  mocks.model.mockResolvedValue(new MockLanguageModelV4({
    doStream: async () => ({
      stream: new ReadableStream({ start: controller => controller.error(interruption) }),
    }),
  }))

  const result = await secureModelDoStream(byok, { prompt: [] })
  await expect(result.stream.getReader().read()).rejects.toBe(interruption)
  expect(mocks.record).not.toHaveBeenCalled()
})
