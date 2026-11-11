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

test('publisher persists sanitized render_ui previews from streamed tool-argument deltas', async () => {
  const calls: Array<Record<string, unknown>> = []
  mocks.append.mockImplementation(async (input: Record<string, unknown>) => {
    calls.push(input)
    return { accepted: true, duplicate: false, truncated: false }
  })
  const reference = {
    modelId: 'fixture/model', credentialOwnerId: 'user', purpose: 'response', publicStreamVersion: 1,
    personal: { receiptId: 'model:0', access: {
      actorUserId: 'user', runId: 'run', workflowRunId: 'workflow', executionGeneration: 2,
      conversationId: 'conversation', agentRunId: 'delivery', workspaceId: 'workspace',
    } },
  } as unknown as HarnessModelReference
  const specStream = [
    { op: 'add', path: '/root', value: 'view' },
    { op: 'add', path: '/elements/view', value: { type: 'Stack', props: {}, children: [] } },
    { op: 'add', path: '/elements/timeline', value: { type: 'Timeline', props: { title: 'Events', events: [{ id: 'start', at: '09:00', title: 'Started' }] } } },
    { op: 'replace', path: '/elements/view/children', value: ['timeline'] },
  ].map(line => JSON.stringify(line)).join('\n') + '\n'
  const args = JSON.stringify({ summary: 'Building view', specStream })
  const source = new ReadableStream<LanguageModelV4StreamPart>({
    start(controller) {
      controller.enqueue({ type: 'text-delta', id: 'text', delta: 'Before' } as LanguageModelV4StreamPart)
      controller.enqueue({ type: 'tool-input-start', id: 'call-1', toolName: 'render_ui' } as LanguageModelV4StreamPart)
      controller.enqueue({ type: 'tool-input-delta', id: 'call-1', delta: args } as LanguageModelV4StreamPart)
      controller.enqueue({ type: 'tool-input-end', id: 'call-1' } as LanguageModelV4StreamPart)
      controller.enqueue({ type: 'text-delta', id: 'text', delta: ' after' } as LanguageModelV4StreamPart)
      controller.enqueue({ type: 'finish', finishReason: { unified: 'stop', raw: 'stop' }, usage: {} } as LanguageModelV4StreamPart)
      controller.close()
    },
  })
  const reader = publishUnifiedHarnessStream(reference, source, new Set(['render_ui'])).getReader()
  while (!(await reader.read()).done) {}
  const preview = calls.find(call => call.preview) as { preview?: { toolCallId: string; order: number; data?: { kind: string; streaming: boolean; specJson: string } } } | undefined
  expect(preview?.preview).toMatchObject({ toolCallId: 'call-1', order: 0, data: { kind: 'json_render', streaming: true } })
  expect(preview?.preview?.data?.specJson).toContain('Timeline')
  expect(calls.filter(call => call.text).map(call => call.text).join('')).toContain('Before')
  expect(calls.some(call => typeof call.text === 'string' && call.text.includes('specStream'))).toBe(false)
})

test('typed previews publish on an open provider stream for personal and native references', async () => {
  vi.useFakeTimers()
  for (const authority of ['personal', 'native'] as const) {
    const calls: Array<Record<string, unknown>> = []
    mocks.append.mockImplementation(async (input: Record<string, unknown>) => {
      calls.push(input)
      return { accepted: true, duplicate: false, truncated: false }
    })
    const access = {
      actorUserId: 'user', runId: `run:${authority}`, workflowRunId: 'workflow', executionGeneration: 2,
      conversationId: 'conversation', agentRunId: 'delivery', workspaceId: 'workspace',
    }
    const reference = (authority === 'personal'
      ? { personal: { access, receiptId: 'model:0' } }
      : { native: { access: { ...access, principalId: 'principal', agentId: 'agent', agentPrincipalId: 'agent-principal',
        userMessageId: 'user-message', assistantMessageId: 'assistant-message', turnId: 'turn' }, receiptId: 'model:0',
        memoryEnabled: false, sharedRoom: true, requestFingerprint: 'request', streamToDelivery: true } })
    const modelReference = {
      modelId: 'fixture/model', credentialOwnerId: 'user', purpose: 'response', publicStreamVersion: 1,
      ...reference,
    } as unknown as HarnessModelReference
    let sourceController!: ReadableStreamDefaultController<LanguageModelV4StreamPart>
    const source = new ReadableStream<LanguageModelV4StreamPart>({ start(controller) { sourceController = controller } })
    const reader = publishUnifiedHarnessStream(modelReference, source, new Set(['render_ui'])).getReader()
    const receive = async () => {
      const result = await reader.read()
      expect(result.done).toBe(false)
      return result.value!
    }
    sourceController.enqueue({ type: 'text-delta', id: 'text', delta: 'Before. ' } as LanguageModelV4StreamPart)
    await receive()
    sourceController.enqueue({ type: 'tool-input-start', id: 'call-1', toolName: 'render_ui' } as LanguageModelV4StreamPart)
    await receive()

    const firstPatches = [
      { op: 'add', path: '/root', value: 'view' },
      { op: 'add', path: '/elements/view', value: { type: 'Stack', props: {}, children: [] } },
      { op: 'add', path: '/elements/timeline', value: { type: 'Timeline', props: {
        title: 'Events', events: [{ id: 'start', at: '09:00', title: 'Started' }],
      } } },
      { op: 'replace', path: '/elements/view/children', value: ['timeline'] },
    ].map(line => JSON.stringify(line)).join('\n') + '\n'
    const firstPrefix = JSON.stringify({ summary: 'Building view', specStream: firstPatches }).slice(0, -2)
    expect(new TextEncoder().encode(firstPrefix).byteLength).toBeLessThan(4_096)
    sourceController.enqueue({ type: 'tool-input-delta', id: 'call-1', delta: firstPrefix } as LanguageModelV4StreamPart)
    await receive()
    await vi.advanceTimersByTimeAsync(300)
    const firstPreview = calls.map(call => call.preview as { toolCallId: string; order: number; sequence: number; textOffset: number; data?: { specJson?: string } } | undefined)
      .find(Boolean)
    expect(firstPreview).toMatchObject({ toolCallId: 'call-1', order: 0, sequence: 0, textOffset: 8 })
    expect(firstPreview?.data?.specJson).toContain('timeline')

    const nextPatch = JSON.stringify({ op: 'add', path: '/elements/timeline-next', value: { type: 'Timeline', props: {
      title: 'Next', events: [{ id: 'next', at: '10:00', title: 'Next event' }],
    } } })
    const childrenPatch = JSON.stringify({ op: 'replace', path: '/elements/view/children', value: ['timeline', 'timeline-next'] })
    const secondDelta = `${JSON.stringify(`${nextPatch}\n${childrenPatch}\n`).slice(1, -1)}"}`
    sourceController.enqueue({ type: 'tool-input-delta', id: 'call-1', delta: secondDelta } as LanguageModelV4StreamPart)
    await receive()
    await vi.advanceTimersByTimeAsync(300)
    const previews = calls.map(call => call.preview as { toolCallId: string; order: number; sequence: number; textOffset: number; data?: { specJson?: string } } | undefined)
      .filter((preview): preview is NonNullable<typeof preview> => Boolean(preview))
    expect(previews.length).toBeGreaterThanOrEqual(2)
    expect(previews.map(({ toolCallId, order, sequence, textOffset }) => ({ toolCallId, order, sequence, textOffset })))
      .toEqual([{ toolCallId: 'call-1', order: 0, sequence: 0, textOffset: 8 }, { toolCallId: 'call-1', order: 0, sequence: 1, textOffset: 8 }])
    expect(previews.at(-1)?.data?.specJson).toContain('timeline-next')

    sourceController.enqueue({ type: 'tool-input-end', id: 'call-1' } as LanguageModelV4StreamPart)
    await receive()
    sourceController.enqueue({ type: 'finish', finishReason: { unified: 'stop', raw: 'stop' }, usage: {} } as LanguageModelV4StreamPart)
    await receive()
    sourceController.close()
    expect((await reader.read()).done).toBe(true)
    expect(calls.filter(call => typeof call.text === 'string').map(call => call.text).join('')).toBe('Before. ')
  }
})

test('invalid and oversized render_ui arguments clear an already published preview', async () => {
  vi.useFakeTimers()
  for (const invalidInput of ['invalid', 'overflow'] as const) {
    const calls: Array<Record<string, unknown>> = []
    mocks.append.mockImplementation(async (input: Record<string, unknown>) => {
      calls.push(input)
      return { accepted: true, duplicate: false, truncated: false }
    })
    const reference = {
      modelId: 'fixture/model', credentialOwnerId: 'user', purpose: 'response', publicStreamVersion: 1,
      personal: { receiptId: 'model:0', access: {
        actorUserId: 'user', runId: `run:${invalidInput}`, workflowRunId: 'workflow', executionGeneration: 1,
        conversationId: 'conversation', agentRunId: 'delivery', workspaceId: 'workspace',
      } },
    } as unknown as HarnessModelReference
    let sourceController!: ReadableStreamDefaultController<LanguageModelV4StreamPart>
    const source = new ReadableStream<LanguageModelV4StreamPart>({ start(controller) { sourceController = controller } })
    const reader = publishUnifiedHarnessStream(reference, source, new Set(['render_ui'])).getReader()
    const receive = async () => {
      const result = await reader.read()
      expect(result.done).toBe(false)
    }
    sourceController.enqueue({ type: 'tool-input-start', id: 'call-1', toolName: 'render_ui' } as LanguageModelV4StreamPart)
    await receive()
    const patches = [
      { op: 'add', path: '/root', value: 'view' },
      { op: 'add', path: '/elements/view', value: { type: 'Stack', props: {}, children: [] } },
      { op: 'add', path: '/elements/timeline', value: { type: 'Timeline', props: {
        title: 'Events', events: [{ id: 'start', at: '09:00', title: 'Started' }],
      } } },
      { op: 'replace', path: '/elements/view/children', value: ['timeline'] },
    ].map(line => JSON.stringify(line)).join('\n') + '\n'
    const prefix = JSON.stringify({ summary: 'Building view', specStream: patches }).slice(0, -2)
    sourceController.enqueue({ type: 'tool-input-delta', id: 'call-1', delta: prefix } as LanguageModelV4StreamPart)
    await receive()
    await vi.advanceTimersByTimeAsync(300)
    expect(calls.some(call => Boolean(call.preview && (call.preview as { data?: unknown }).data))).toBe(true)

    const suffix = invalidInput === 'invalid'
      ? `${JSON.stringify(`${JSON.stringify({ op: 'remove', path: '/root' })}\n`).slice(1, -1)}"}`
      : 'x'.repeat(300 * 1024)
    sourceController.enqueue({ type: 'tool-input-delta', id: 'call-1', delta: suffix } as LanguageModelV4StreamPart)
    await receive()
    await vi.advanceTimersByTimeAsync(300)
    const updates = calls.map(call => call.preview as { sequence: number; data?: unknown } | undefined).filter(Boolean)
    expect(updates.at(-1)).toMatchObject({ sequence: 1 })
    expect(updates.at(-1)).not.toHaveProperty('data')
    await reader.cancel()
  }
})
