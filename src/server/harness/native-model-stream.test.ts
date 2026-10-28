import { beforeEach, expect, test, vi } from 'vitest'
import type { LanguageModelV4StreamPart } from '@ai-sdk/provider'
import { MockLanguageModelV4 } from 'ai/test'
import { projectNativeHarnessStream } from './native-model-stream'
import { secureModelDoStream } from './secure-model-runtime'
import type { HarnessModelReference } from './secure-model'
import { MAX_PERSISTED_ASSISTANT_CONTENT_CHARS } from '@/shared/chat/persist-assistant-turn'

const mocks = vi.hoisted(() => ({ list: vi.fn(), append: vi.fn(), refresh: vi.fn(), model: vi.fn(), finalize: vi.fn(), warn: vi.fn() }))
vi.mock('server-only', () => ({}))
vi.mock('./native-access', () => ({ refreshNativeHarnessAccess: mocks.refresh }))
vi.mock('@/server/ai/model-runtime', () => ({ getLanguageModel: mocks.model }))
vi.mock('@/server/observability/logger', () => ({ logger: { warn: mocks.warn, error: mocks.warn } }))
vi.mock('@/server/bootstrap', () => ({ getOverlayServerContext: () => ({ appData: { repositories: {
  conversationCollaboration: { listMessages: mocks.list, appendAgentMessageDelta: mocks.append, finalizeAgentMessage: mocks.finalize },
} } }) }))

const reference: HarnessModelReference = { modelId: 'openrouter/free', credentialOwnerId: 'human', native: {
  access: { actorUserId: 'human', runId: 'workspace:delivery', workflowRunId: 'workflow', workspaceId: 'workspace',
    principalId: 'human-principal', agentId: 'agent', agentPrincipalId: 'agent-principal', conversationId: 'room',
    agentRunId: 'delivery', userMessageId: 'question', assistantMessageId: 'answer', turnId: 'turn' },
  receiptId: 'model:0', memoryEnabled: false, sharedRoom: true, requestFingerprint: 'request', streamToDelivery: true,
  inputTokenBudget: 2_000, maxOutputTokens: 100, contextWindow: null,
} }
const message = { _id: 'answer', turnId: 'turn', authorKind: 'agent', authorPrincipalId: 'agent-principal', status: 'generating', content: '', parts: [] }
const finish: LanguageModelV4StreamPart = { type: 'finish', finishReason: { unified: 'stop', raw: 'stop' }, usage: {
  inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 5, text: 5, reasoning: 0 },
} }
const text = (delta: string): LanguageModelV4StreamPart => ({ type: 'text-delta', id: 'text', delta })
const source = (parts: LanguageModelV4StreamPart[]) => new ReadableStream<LanguageModelV4StreamPart>({
  start(controller) { parts.forEach(part => controller.enqueue(part)); controller.close() },
})
async function drain(stream: ReadableStream<LanguageModelV4StreamPart>) {
  const reader = stream.getReader()
  const parts: LanguageModelV4StreamPart[] = []
  for (;;) {
    const next = await reader.read()
    if (next.done) return parts
    parts.push(next.value)
  }
}

beforeEach(() => {
  vi.resetAllMocks()
  mocks.list.mockResolvedValue([message])
  mocks.refresh.mockResolvedValue({})
  mocks.append.mockResolvedValue(undefined)
})

test('native text streams before inference finishes, preserving usage and excluding reasoning', async () => {
  let controller!: ReadableStreamDefaultController<LanguageModelV4StreamPart>
  let written!: () => void
  const firstWrite = new Promise<void>(resolve => { written = resolve })
  mocks.append.mockImplementationOnce(async () => { written() })
  const provider = new ReadableStream<LanguageModelV4StreamPart>({ start(value) { controller = value } })
  const reading = drain(await projectNativeHarnessStream(reference, provider))
  controller.enqueue({ type: 'reasoning-delta', id: 'reason', delta: 'private planning' })
  controller.enqueue(text('Visible response '.repeat(20)))
  await firstWrite
  expect(mocks.append).toHaveBeenCalledWith(expect.objectContaining({ messageId: 'answer', conversationId: 'room' }))
  expect(JSON.stringify(mocks.append.mock.calls)).not.toContain('private planning')
  controller.enqueue(finish)
  controller.close()
  const parts = await reading
  expect(parts.at(-1)).toBe(finish)
  expect(mocks.refresh).toHaveBeenCalledWith(reference.native!.access, expect.objectContaining({ sharedRoom: true }))
  expect(mocks.finalize).not.toHaveBeenCalled()
})

test('native projection holds split protocol markers and drops the call and following deltas', async () => {
  const parts = [
    text('The capital of France is Paris. <tool_'),
    text('call>harness_update_step arguments'),
    text(' that must stay hidden'),
    finish,
  ]
  expect(await drain(await projectNativeHarnessStream(reference, source(parts)))).toEqual(parts)
  expect(mocks.append.mock.calls.map(([args]) => args.contentDelta).join('')).toBe('The capital of France is Paris. ')
  expect(JSON.stringify(mocks.append.mock.calls)).not.toContain('<tool_call>')
  expect(JSON.stringify(mocks.append.mock.calls)).not.toContain('must stay hidden')
})

test('native projection flushes an unresolved marker prefix at finish', async () => {
  const parts = [text('Visible <tool_'), finish]
  expect(await drain(await projectNativeHarnessStream(reference, source(parts)))).toEqual(parts)
  expect(mocks.append.mock.calls.map(([args]) => args.contentDelta).join('')).toBe('Visible <tool_')
})

test('the real provider middleware removes tagged reasoning before native room projection', async () => {
  const provider = new MockLanguageModelV4({ doStream: async () => ({ stream: source([
    { type: 'text-start', id: 'text' }, text('<think>Hidden thought</think>Public answer'), { type: 'text-end', id: 'text' }, finish,
  ]) }) })
  mocks.model.mockResolvedValue(provider)
  const result = await secureModelDoStream(reference, { prompt: [] })
  const parts = await drain(result.stream)
  expect(parts.filter(part => part.type === 'text-delta').map(part => part.delta).join('')).toBe('Public answer')
  expect(mocks.append.mock.calls.map(([args]) => args.contentDelta).join('')).toBe('Public answer')
  expect(JSON.stringify(mocks.append.mock.calls)).not.toContain('Hidden thought')
  expect(parts.at(-1)).toEqual(finish)
  expect(provider.doStreamCalls).toHaveLength(1)
})

test('summary calls, anonymous children, stale rows and other agent identities cannot write the delivery', async () => {
  for (const candidate of [
    { ...reference, native: { ...reference.native!, streamToDelivery: false } },
    { ...reference, native: { ...reference.native!, access: { ...reference.native!.access, runId: 'anonymous-child' } } },
  ]) {
    const stream = source([text('Internal'), finish])
    expect(await projectNativeHarnessStream(candidate, stream)).toBe(stream)
  }
  expect(mocks.list).not.toHaveBeenCalled()
  for (const row of [{ ...message, status: 'completed' }, { ...message, authorPrincipalId: 'other-agent' }]) {
    mocks.list.mockResolvedValueOnce([row])
    const stream = source([text('Late'), finish])
    expect(await projectNativeHarnessStream(reference, stream)).toBe(stream)
  }
  expect(mocks.append).not.toHaveBeenCalled()
})

test('revocation and persistence failures never retry or cancel the provider stream', async () => {
  mocks.refresh.mockRejectedValueOnce(new Error('revoked'))
  const parts = [text('Visible'), finish]
  expect(await drain(await projectNativeHarnessStream(reference, source(parts)))).toEqual(parts)
  expect(mocks.append).not.toHaveBeenCalled()
  mocks.append.mockRejectedValueOnce(new Error('write unavailable'))
  expect(await drain(await projectNativeHarnessStream(reference, source(parts)))).toEqual(parts)
  expect(mocks.append).toHaveBeenCalledTimes(1)
  mocks.list.mockRejectedValueOnce(new Error('read unavailable'))
  const stream = source(parts)
  expect(await projectNativeHarnessStream(reference, stream)).toBe(stream)
})

test('live text remains bounded while provider output is untouched', async () => {
  mocks.list.mockResolvedValue([{ ...message, content: 'x'.repeat(MAX_PERSISTED_ASSISTANT_CONTENT_CHARS - 8),
    parts: [{ type: 'reasoning', text: 'old secret' }, { type: 'text', text: 'Previous' }] }])
  const parts = [text('More output than the live row can hold'), finish]
  expect(await drain(await projectNativeHarnessStream(reference, source(parts)))).toEqual(parts)
  expect(mocks.append.mock.calls.map(([args]) => args.contentDelta).join('')).toBe('\n\nMore o')
  expect(JSON.stringify(mocks.append.mock.calls)).not.toContain('old secret')
})
