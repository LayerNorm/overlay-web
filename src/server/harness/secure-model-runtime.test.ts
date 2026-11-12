import { beforeEach, expect, test, vi } from 'vitest'
import { MockLanguageModelV4 } from 'ai/test'
import { APICallError, StreamProviderError } from 'ai'
import type { LanguageModelV4StreamPart } from '@ai-sdk/provider'
import type { HarnessModelReference } from './secure-model'
import { secureModelDoGenerate, secureModelDoStream } from './secure-model-runtime'
import { personalHarnessPolicy } from './personal-admission-policy'
import { harnessExecutionFailureReason } from './execution-failure'

vi.mock('server-only', () => ({}))
const mocks = vi.hoisted(() => ({ model: vi.fn(), record: vi.fn(), confirmed: vi.fn(), append: vi.fn() }))
vi.mock('@/server/ai/model-runtime', () => ({ getLanguageModel: mocks.model }))
vi.mock('./model-rejection', () => ({ recordHarnessModelRejection: mocks.record, isConfirmedHarnessModelRejection: mocks.confirmed }))
vi.mock('./ConvexHarnessRepository', () => ({ ConvexHarnessRepository: class {
  appendPublicStream(input: unknown) { return mocks.append(input) }
} }))

const reference: HarnessModelReference = { modelId: 'openai/gpt-4.1-mini', credentialOwnerId: 'user', personal: {
  access: { actorUserId: 'user', runId: 'run', workflowRunId: 'workflow', conversationId: 'conversation', agentRunId: 'delivery',
    workspaceId: 'workspace', principalId: 'principal', authentication: { type: 'session' } },
  receiptId: 'model:0', memoryEnabled: false, requestFingerprint: 'request', maxOutputTokens: 100, contextWindow: null,
} }

const nativeReference: HarnessModelReference = { modelId: 'openai/gpt-4.1-mini', credentialOwnerId: 'user', native: {
  access: { actorUserId: 'user', runId: 'workspace:delivery', workflowRunId: 'workflow', workspaceId: 'workspace',
    principalId: 'human-principal', agentId: 'agent', agentPrincipalId: 'agent-principal', conversationId: 'room',
    agentRunId: 'delivery', userMessageId: 'question', assistantMessageId: 'answer', turnId: 'turn' },
  receiptId: 'model:0', memoryEnabled: false, sharedRoom: true, requestFingerprint: 'request',
  maxOutputTokens: 100, contextWindow: null,
} }

const automationReference: HarnessModelReference = {
  ...reference,
  modelId: 'gemini-3.8-flash',
  personal: {
    ...reference.personal!,
    access: {
      ...reference.personal!.access,
      authentication: { type: 'automation', automationId: 'automation', originWorkflowRunId: 'workflow' },
    },
  },
}

const renderUiTool = { type: 'function' as const, name: 'render_ui', description: 'render UI', inputSchema: {} }

beforeEach(() => { vi.resetAllMocks(); mocks.confirmed.mockReturnValue(false); mocks.append.mockResolvedValue({ accepted: true }) })

test.each([
  ['personal', { ...reference, modelId: 'google/gemini-3.8-flash' }],
  ['native', { ...nativeReference, modelId: 'google/gemini-3.8-flash' }],
  ['automation with legacy Gemini id', automationReference],
] as const)('%s Gemini 3 render_ui stream enables Vertex function-argument streaming', async (_surface, dispatchReference) => {
  const provider = new MockLanguageModelV4({ doStream: {
    stream: new ReadableStream<LanguageModelV4StreamPart>({ start(controller) { controller.close() } }),
  } })
  mocks.model.mockResolvedValue(provider)
  const providerOptions = {
    gateway: { only: ['baseten'], order: ['baseten'], zeroDataRetention: true },
    vertex: { region: 'us-central1' },
    anthropic: { thinking: { type: 'enabled' } },
  }
  const providerOptionsSnapshot = structuredClone(providerOptions)
  const abortSignal = new AbortController().signal
  const toolChoice = { type: 'tool' as const, toolName: 'render_ui' }
  const options = { prompt: [], tools: [renderUiTool], maxOutputTokens: 73, temperature: 0.4, abortSignal, toolChoice, providerOptions }

  await secureModelDoStream(dispatchReference, options)

  expect(provider.doStreamCalls[0]?.providerOptions).toEqual({
    ...providerOptions,
    vertex: { ...providerOptions.vertex, streamFunctionCallArguments: true },
  })
  expect(provider.doStreamCalls[0]?.maxOutputTokens).toBe(73)
  expect(provider.doStreamCalls[0]?.temperature).toBe(0.4)
  expect(provider.doStreamCalls[0]?.abortSignal).toBe(abortSignal)
  expect(provider.doStreamCalls[0]?.toolChoice).toEqual(toolChoice)
  expect(options.providerOptions).toEqual(providerOptionsSnapshot)
})

test.each([
  ['Gemini 2', { ...reference, modelId: 'google/gemini-2.5-flash' }, [renderUiTool]],
  ['other Google model', { ...reference, modelId: 'google/gemma-4-26b-a4b-it' }, [renderUiTool]],
  ['other provider', { ...reference, modelId: 'anthropic/claude-sonnet-5.5' }, [renderUiTool]],
  ['OpenRouter', { ...reference, modelId: 'openrouter/google/gemini-3.8-flash' }, [renderUiTool]],
  ['BYOK', { ...reference, modelId: 'byok/connection/google/gemini-3.8-flash' }, [renderUiTool]],
  ['no render_ui', { ...reference, modelId: 'google/gemini-3.8-flash' }, [{ ...renderUiTool, name: 'other_tool' }]],
] as const)('%s does not enable Vertex function-argument streaming', async (_case, dispatchReference, tools) => {
  const provider = new MockLanguageModelV4({ doStream: {
    stream: new ReadableStream<LanguageModelV4StreamPart>({ start(controller) { controller.close() } }),
  } })
  mocks.model.mockResolvedValue(provider)
  const providerOptions = { vertex: { region: 'us-central1' }, gateway: { only: ['baseten'] } }

  await secureModelDoStream(dispatchReference, { prompt: [], tools, providerOptions })

  expect(provider.doStreamCalls[0]?.providerOptions).toEqual(providerOptions)
})

test('explicit false remains false for Gemini 3 render_ui streams', async () => {
  const provider = new MockLanguageModelV4({ doStream: {
    stream: new ReadableStream<LanguageModelV4StreamPart>({ start(controller) { controller.close() } }),
  } })
  mocks.model.mockResolvedValue(provider)
  const providerOptions = {
    vertex: { region: 'us-central1', streamFunctionCallArguments: false },
    gateway: { only: ['baseten'], order: ['baseten'], zeroDataRetention: true },
  }

  await secureModelDoStream({ ...reference, modelId: 'google/gemini-3.8-flash' }, {
    prompt: [], tools: [renderUiTool], providerOptions,
  })

  expect(provider.doStreamCalls[0]?.providerOptions).toEqual(providerOptions)
  expect(providerOptions.vertex.streamFunctionCallArguments).toBe(false)
})

test('Gemini 3 render_ui streams enable Vertex argument streaming without existing provider options', async () => {
  const provider = new MockLanguageModelV4({ doStream: {
    stream: new ReadableStream<LanguageModelV4StreamPart>({ start(controller) { controller.close() } }),
  } })
  mocks.model.mockResolvedValue(provider)
  const options = { prompt: [], tools: [renderUiTool] }

  await secureModelDoStream({ ...reference, modelId: 'google/gemini-3.8-flash' }, options)

  expect(provider.doStreamCalls[0]?.providerOptions).toEqual({
    vertex: { streamFunctionCallArguments: true },
  })
  expect(options).not.toHaveProperty('providerOptions')
})

test('Gemini 3 render_ui doGenerate does not add Vertex function-argument streaming', async () => {
  const providerOptions = { vertex: { region: 'us-central1' } }
  const provider = new MockLanguageModelV4({ doGenerate: {
    content: [], finishReason: { unified: 'stop', raw: 'stop' },
    usage: { inputTokens: { total: 0, noCache: 0, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 0, text: 0, reasoning: 0 } },
    warnings: [],
  } })
  mocks.model.mockResolvedValue(provider)

  await secureModelDoGenerate({ ...reference, modelId: 'google/gemini-3.8-flash' }, {
    prompt: [], tools: [renderUiTool], providerOptions,
  })

  expect(provider.doGenerateCalls[0]?.providerOptions).toEqual(providerOptions)
})

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

test.each([
  ['personal', reference],
  ['native', nativeReference],
] as const)('default-policy %s dispatch publishes real render_ui input deltas through the secure wrapper', async (_surface, dispatchReference) => {
  const specStream = [
    { op: 'add', path: '/root', value: 'root' },
    { op: 'add', path: '/elements/root', value: { type: 'Stack', props: {}, children: [] } },
  ].map(line => JSON.stringify(line)).join('\n') + '\n'
  const argument = JSON.stringify({ summary: 'Building', specStream })
  const provider = new MockLanguageModelV4({ doStream: async () => ({
    stream: new ReadableStream<LanguageModelV4StreamPart>({ start(controller) {
      controller.enqueue({ type: 'tool-input-start', id: 'render-1', toolName: 'render_ui' })
      controller.enqueue({ type: 'tool-input-delta', id: 'render-1', delta: argument.slice(0, Math.ceil(argument.length / 2)) })
      controller.enqueue({ type: 'tool-input-delta', id: 'render-1', delta: argument.slice(Math.ceil(argument.length / 2)) })
      controller.enqueue({ type: 'tool-input-end', id: 'render-1' })
      controller.close()
    } }),
  }) })
  mocks.model.mockResolvedValue(provider)
  const publicStreamVersion = personalHarnessPolicy({
    actorUserId: 'user', workspaceId: 'workspace', allowedToolIds: ['render_ui'],
    modelId: 'fixture/model', paid: true, createdAt: 1_000,
  }).publicStreamVersion
  const result = await secureModelDoStream({ ...dispatchReference, purpose: 'response', publicStreamVersion }, {
    prompt: [], tools: [{ type: 'function', name: 'render_ui', description: 'render', inputSchema: {} }],
  })
  const reader = result.stream.getReader()
  while (!(await reader.read()).done) {}
  expect(mocks.append).toHaveBeenCalledWith(expect.objectContaining({
    text: '', preview: expect.objectContaining({ toolCallId: 'render-1', data: expect.objectContaining({ streaming: true }) }),
  }))
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
