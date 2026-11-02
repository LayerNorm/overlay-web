import { beforeEach, expect, test, vi } from 'vitest'
import { MockLanguageModelV4 } from 'ai/test'
import { APICallError, StreamProviderError } from 'ai'
import type { LanguageModelV4StreamPart } from '@ai-sdk/provider'
import type { HarnessModelReference } from './secure-model'
import { secureModelDoGenerate, secureModelDoStream } from './secure-model-runtime'
import { harnessExecutionFailureReason } from './execution-failure'

const mocks = vi.hoisted(() => ({ model: vi.fn(), record: vi.fn(), confirmed: vi.fn() }))
vi.mock('@/server/ai/model-runtime', () => ({ getLanguageModel: mocks.model }))
vi.mock('./model-rejection', () => ({ recordHarnessModelRejection: mocks.record, isConfirmedHarnessModelRejection: mocks.confirmed }))

const reference: HarnessModelReference = { modelId: 'openai/gpt-4.1-mini', credentialOwnerId: 'user', personal: {
  access: { actorUserId: 'user', runId: 'run', workflowRunId: 'workflow', conversationId: 'conversation', agentRunId: 'delivery',
    workspaceId: 'workspace', principalId: 'principal', authentication: { type: 'session' } },
  receiptId: 'model:0', memoryEnabled: false, requestFingerprint: 'request', inputTokenBudget: 100, maxOutputTokens: 100, contextWindow: null,
} }

const nativeReference: HarnessModelReference = { modelId: 'openai/gpt-4.1-mini', credentialOwnerId: 'user', native: {
  access: { actorUserId: 'user', runId: 'workspace:delivery', workflowRunId: 'workflow', workspaceId: 'workspace',
    principalId: 'human-principal', agentId: 'agent', agentPrincipalId: 'agent-principal', conversationId: 'room',
    agentRunId: 'delivery', userMessageId: 'question', assistantMessageId: 'answer', turnId: 'turn' },
  receiptId: 'model:0', memoryEnabled: false, sharedRoom: true, requestFingerprint: 'request',
  inputTokenBudget: 100, maxOutputTokens: 100, contextWindow: null,
} }

beforeEach(() => { vi.resetAllMocks(); mocks.confirmed.mockReturnValue(false) })

test.each([
  [secureModelDoStream, reference], [secureModelDoGenerate, reference],
  [secureModelDoStream, nativeReference], [secureModelDoGenerate, nativeReference],
] as const)('preserves SDK details after recording provider rejection, with one dispatch', async (invoke, dispatchReference) => {
  const error = new APICallError({ message: 'private', url: 'https://private.test', requestBodyValues: {}, statusCode: 429 })
  const dispatch = vi.fn(async () => { throw error })
  mocks.model.mockResolvedValue(new MockLanguageModelV4({ doStream: dispatch, doGenerate: dispatch }))
  mocks.confirmed.mockReturnValue(true)
  await expect(invoke(dispatchReference, { prompt: [] })).rejects.toMatchObject({ name: 'HarnessModelFailure', message: harnessExecutionFailureReason(error) })
  expect(mocks.confirmed).toHaveBeenCalledWith(error)
  expect(mocks.record).toHaveBeenCalledExactlyOnceWith(dispatchReference, 'model_unavailable')
  expect(dispatch).toHaveBeenCalledOnce()
})

test.each(['part', 'throw'] as const)('preserves mid-stream SDK %s failures and prior text, including BYOK', async mode => {
  const error = new StreamProviderError({ message: 'private', statusCode: 503, isRetryable: true })
  let emitted = false
  const provider = new MockLanguageModelV4({ doStream: async () => ({
    stream: new ReadableStream<LanguageModelV4StreamPart>({ pull(controller) {
      if (!emitted) {
        emitted = true
        controller.enqueue({ type: 'text-delta', id: 'text', delta: 'Partial answer' })
      } else if (mode === 'throw') controller.error(error)
      else { controller.enqueue({ type: 'error', error }); controller.close() }
    } }),
  }) })
  mocks.model.mockResolvedValue(provider)
  const result = await secureModelDoStream({ ...reference, modelId: 'byok/fixture' }, { prompt: [] })
  const reader = result.stream.getReader()
  expect((await reader.read()).value).toMatchObject({ type: 'text-delta', delta: 'Partial answer' })
  if (mode === 'throw') {
    await expect(reader.read()).rejects.toMatchObject({ name: 'HarnessModelFailure', message: harnessExecutionFailureReason(error) })
  } else {
    expect((await reader.read()).value).toMatchObject({ type: 'error', error: { name: 'HarnessModelFailure', message: harnessExecutionFailureReason(error) } })
    expect((await reader.read()).done).toBe(true)
  }
  expect(provider.doStreamCalls).toHaveLength(1)
  expect(mocks.record).not.toHaveBeenCalled()
})

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

test('non-SDK BYOK stream interruptions preserve the error without rejection receipts', async () => {
  const interruption = new Error('Connection interrupted')
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
