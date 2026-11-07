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
