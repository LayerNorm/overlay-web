import { afterEach, expect, test, vi } from 'vitest'
import type { LanguageModelV4StreamPart } from '@ai-sdk/provider'
import type { HarnessModelReference } from './secure-model'

const mocks = vi.hoisted(() => ({ append: vi.fn(), info: vi.fn() }))
vi.mock('server-only', () => ({}))
vi.mock('./ConvexHarnessRepository', () => ({
  ConvexHarnessRepository: class { appendPublicStream = mocks.append },
}))
vi.mock('@/server/observability/logger', () => ({ logger: { info: mocks.info } }))

const { PublicTextProjector, publishUnifiedHarnessStream } = await import('./public-stream-publisher')

afterEach(() => { vi.useRealTimers(); vi.resetAllMocks() })

test('ordinary fenced code streams without holding the complete fence', () => {
  const projector = new PublicTextProjector(new Set(['read_file']))
  expect(projector.push('```ts\nconst answer =')).toEqual(['```ts\n', 'const answer ='])
  expect(projector.push(' 42\n```')).toEqual([' 42\n'])
  expect(projector.flush()).toEqual(['```'])
})

test('split tool marker and known tool JSON are suppressed while ordinary JSON remains safe', () => {
  const projector = new PublicTextProjector(new Set(['read_file']))
  expect(projector.push('Before\n<tool_')).toEqual(['Before\n'])
  expect(projector.push('call>{"name":"read_file"}')).toEqual([])
  expect(projector.push('</tool_call>After')).toEqual(['After'])

  const json = new PublicTextProjector(new Set(['read_file']))
  expect(json.push('{"name":"read_file","arguments":{}}')).toEqual([])
  expect(json.push('\n\n')).toEqual([])
  const ordinary = new PublicTextProjector(new Set(['read_file']))
  expect(ordinary.push('{"status":"ready"}\n\n')).toEqual(['{"status":"ready"}'])
})

test('split closing markers and same-chunk trailing prose are handled without leaking tool payloads', () => {
  const split = new PublicTextProjector(new Set(['read_file']))
  expect(split.push('<tool_call>{"name":"read_file"}</tool_call>')).toEqual([])
  expect(split.push('prose')).toEqual(['prose'])

  const ending = new PublicTextProjector(new Set(['read_file']))
  expect(ending.push('<tool_call>{"name":"read_file"}')).toEqual([])
  expect(ending.push('</tool_')).toEqual([])
  expect(ending.push('call> trailing')).toEqual([' trailing'])
})

test('incomplete known-tool fences and oversized ambiguous candidates fail closed', () => {
  const fenced = new PublicTextProjector(new Set(['read_file']))
  expect(fenced.push('```json\n{"name":"read_file","arguments":{"path":"x"}')).toEqual([])
  expect(fenced.flush()).toEqual([])

  const oversized = new PublicTextProjector(new Set(['read_file']))
  expect(oversized.push(`{"name":"read_file","arguments":{"path":"${'x'.repeat(20_000)}`)).toEqual([])
  expect(oversized.flush()).toEqual([])
})

test('oversized fenced tool candidates suppress their private tail and resume safe prose', () => {
  const projector = new PublicTextProjector(new Set(['read_file']))
  expect(projector.push('```json\n{"name":"read_file","arguments":{"path":"')).toEqual([])
  expect(projector.push('x'.repeat(16_500))).toEqual([])
  expect(projector.push('private-tail-secret\n\n')).toEqual([])
  expect(projector.push('```\nSafe prose')).toEqual(['Safe prose'])
  expect(projector.flush()).toEqual([])
})

test('JSON fences transition back to ordinary prose after the closing fence', () => {
  const projector = new PublicTextProjector(new Set(['read_file']))
  expect(projector.push('```json\n{"status":"ready"}\n```\nAfter')).toEqual([
    '```json\n{"status":"ready"}\n```\n', 'After',
  ])
})

test('publisher retries an idempotent sequence and never alters inference output on persistence errors', async () => {
  const calls: unknown[] = []
  mocks.append.mockImplementation(async (input: unknown) => {
    calls.push(input)
    if (calls.length === 1) throw new Error('ack lost')
    return { accepted: true, duplicate: false, truncated: false }
  })
  const reference = {
    modelId: 'fixture/model', credentialOwnerId: 'user', purpose: 'response', publicStreamVersion: 1,
    personal: { receiptId: 'model:0', access: {
      actorUserId: 'user', runId: 'run', workflowRunId: 'workflow', executionGeneration: 2,
      conversationId: 'conversation', agentRunId: 'delivery', workspaceId: 'workspace',
    } },
  } as unknown as HarnessModelReference
  const source = new ReadableStream<LanguageModelV4StreamPart>({
    start(controller) {
      controller.enqueue({ type: 'text-delta', id: 'text', delta: 'Hello' })
      controller.enqueue({ type: 'finish', finishReason: { unified: 'stop', raw: 'stop' }, usage: {} })
      controller.close()
    },
  })
  const reader = publishUnifiedHarnessStream(reference, source, new Set()).getReader()
  const output: LanguageModelV4StreamPart[] = []
  while (true) {
    const result = await reader.read()
    if (result.done) break
    output.push(result.value)
  }
  expect(output).toHaveLength(2)
  expect(calls).toHaveLength(2)
  expect(calls[0]).toEqual(calls[1])
  expect(output[0]).toMatchObject({ type: 'text-delta', delta: 'Hello' })
})

test('publisher lets the provider advance during a slow write and drains trailing text at a boundary', async () => {
  let release: (() => void) | undefined
  const calls: unknown[] = []
  mocks.append.mockImplementation(async (input: unknown) => {
    calls.push(input)
    if (calls.length === 1) await new Promise<void>(resolve => { release = resolve })
    return { accepted: true, duplicate: false, truncated: false }
  })
  const reference = {
    modelId: 'fixture/model', credentialOwnerId: 'user', purpose: 'response', publicStreamVersion: 1,
    personal: { receiptId: 'model:0', access: {
      actorUserId: 'user', runId: 'run', workflowRunId: 'workflow', executionGeneration: 2,
      conversationId: 'conversation', agentRunId: 'delivery', workspaceId: 'workspace',
    } },
  } as unknown as HarnessModelReference
  const source = new ReadableStream<LanguageModelV4StreamPart>({
    start(controller) {
      controller.enqueue({ type: 'text-delta', id: 'text', delta: 'first' })
      controller.enqueue({ type: 'text-delta', id: 'text', delta: 'tail' })
      controller.enqueue({ type: 'tool-call', toolCallId: 'tool', toolName: 'read_file', input: {} } as never)
      controller.enqueue({ type: 'finish', finishReason: { unified: 'stop', raw: 'stop' }, usage: {} })
      controller.close()
    },
  })
  const reader = publishUnifiedHarnessStream(reference, source, new Set()).getReader()
  const first = await reader.read()
  expect(first.value).toMatchObject({ type: 'text-delta', delta: 'first' })
  const second = await Promise.race([
    reader.read(),
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error('provider was backpressured')), 100)),
  ])
  expect(second.value).toMatchObject({ type: 'text-delta', delta: 'tail' })
  expect(calls).toHaveLength(1)
  release?.()
  while (!(await reader.read()).done) {}
  expect(calls).toHaveLength(2)
  expect(calls.map(call => (call as { text: string }).text)).toEqual(['first', 'tail'])
})

test('persistence failure disables future writes without failing the provider stream', async () => {
  mocks.append.mockRejectedValue(new Error('convex unavailable'))
  const reference = {
    modelId: 'fixture/model', credentialOwnerId: 'user', purpose: 'response', publicStreamVersion: 1,
    personal: { receiptId: 'model:0', access: {
      actorUserId: 'user', runId: 'run', workflowRunId: 'workflow', executionGeneration: 2,
      conversationId: 'conversation', agentRunId: 'delivery', workspaceId: 'workspace',
    } },
  } as unknown as HarnessModelReference
  const source = new ReadableStream<LanguageModelV4StreamPart>({
    start(controller) {
      controller.enqueue({ type: 'text-delta', id: 'text', delta: 'still visible' })
      controller.enqueue({ type: 'finish', finishReason: { unified: 'stop', raw: 'stop' }, usage: {} })
      controller.close()
    },
  })
  const reader = publishUnifiedHarnessStream(reference, source, new Set()).getReader()
  const output: LanguageModelV4StreamPart[] = []
  while (true) {
    const result = await reader.read()
    if (result.done) break
    output.push(result.value)
  }
  expect(output[0]).toMatchObject({ type: 'text-delta', delta: 'still visible' })
  expect(mocks.append).toHaveBeenCalledTimes(2)
})

test('a sub-threshold tail flushes on the timer without another provider token', async () => {
  vi.useFakeTimers()
  mocks.append.mockResolvedValue({ accepted: true, duplicate: false, truncated: false })
  const reference = {
    modelId: 'fixture/model', credentialOwnerId: 'user', purpose: 'response', publicStreamVersion: 1,
    personal: { receiptId: 'model:0', access: {
      actorUserId: 'user', runId: 'run', workflowRunId: 'workflow', executionGeneration: 2,
      conversationId: 'conversation', agentRunId: 'delivery', workspaceId: 'workspace',
    } },
  } as unknown as HarnessModelReference
  let sourceController!: ReadableStreamDefaultController<LanguageModelV4StreamPart>
  const source = new ReadableStream<LanguageModelV4StreamPart>({
    start(controller) { sourceController = controller },
  })
  const reader = publishUnifiedHarnessStream(reference, source, new Set()).getReader()
  sourceController.enqueue({ type: 'text-delta', id: 'text', delta: 'a'.repeat(8_192) })
  await reader.read()
  await Promise.resolve()
  expect(mocks.append).toHaveBeenCalledTimes(1)
  sourceController.enqueue({ type: 'text-delta', id: 'text', delta: 'tail' })
  await reader.read()
  expect(mocks.append).toHaveBeenCalledTimes(1)
  await vi.advanceTimersByTimeAsync(75)
  expect(mocks.append).toHaveBeenCalledTimes(2)
  await reader.cancel()
})

test('pending public text never exceeds the configured backpressure bound', async () => {
  let release: (() => void) | undefined
  let calls = 0
  let firstWriteStarted!: () => void
  const firstWrite = new Promise<void>(resolve => { firstWriteStarted = resolve })
  mocks.append.mockImplementation(async () => {
    calls++
    if (calls === 1) {
      firstWriteStarted()
      await new Promise<void>(resolve => { release = resolve })
    }
    return { accepted: true, duplicate: false, truncated: false }
  })
  const reference = {
    modelId: 'fixture/model', credentialOwnerId: 'user', purpose: 'response', publicStreamVersion: 1,
    personal: { receiptId: 'model:0', access: {
      actorUserId: 'user', runId: 'run', workflowRunId: 'workflow', executionGeneration: 2,
      conversationId: 'conversation', agentRunId: 'delivery', workspaceId: 'workspace',
    } },
  } as unknown as HarnessModelReference
  const source = new ReadableStream<LanguageModelV4StreamPart>({
    start(controller) {
      controller.enqueue({ type: 'text-delta', id: 'text', delta: `${'x'.repeat(150_000)}\n` })
      controller.enqueue({ type: 'finish', finishReason: { unified: 'stop', raw: 'stop' }, usage: {} })
      controller.close()
    },
  })
  const reader = publishUnifiedHarnessStream(reference, source, new Set()).getReader()
  const output = (async () => {
    while (!(await reader.read()).done) {}
  })()
  await firstWrite
  expect(calls).toBe(1)
  release?.()
  await output
  const finish = mocks.info.mock.calls.map(call => call[1] as Record<string, unknown>)
    .find(event => event.event === 'stream_finish')
  expect(finish?.peakPendingBytes).toBeLessThanOrEqual(64 * 1024)
})

test('a source error drains safe partial text and clears pending timers', async () => {
  vi.useFakeTimers()
  const writes: string[] = []
  mocks.append.mockImplementation(async (input: { text: string }) => {
    writes.push(input.text)
    return { accepted: true, duplicate: false, truncated: false }
  })
  const reference = {
    modelId: 'fixture/model', credentialOwnerId: 'user', purpose: 'response', publicStreamVersion: 1,
    personal: { receiptId: 'model:0', access: {
      actorUserId: 'user', runId: 'run', workflowRunId: 'workflow', executionGeneration: 2,
      conversationId: 'conversation', agentRunId: 'delivery', workspaceId: 'workspace',
    } },
  } as unknown as HarnessModelReference
  let sourceController!: ReadableStreamDefaultController<LanguageModelV4StreamPart>
  const source = new ReadableStream<LanguageModelV4StreamPart>({
    start(controller) { sourceController = controller },
  })
  const reader = publishUnifiedHarnessStream(reference, source, new Set()).getReader()
  sourceController.enqueue({ type: 'text-delta', id: 'text', delta: `${'a'.repeat(8_192)}\n` })
  await reader.read()
  sourceController.enqueue({ type: 'text-delta', id: 'text', delta: 'safe tail\n' })
  await reader.read()
  expect(vi.getTimerCount()).toBeGreaterThan(0)
  sourceController.error(new Error('provider stream failed'))
  const drain = async () => { while (!(await reader.read()).done) {} }
  await expect(drain()).rejects.toThrow('provider stream failed')
  expect(writes.join('')).toContain('safe tail')
  expect(vi.getTimerCount()).toBe(0)
})
