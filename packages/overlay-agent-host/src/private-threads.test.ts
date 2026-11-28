import assert from 'node:assert/strict'
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import type { LanguageModelV4StreamPart } from '@ai-sdk/provider'
import { tool } from 'ai'
import { MockLanguageModelV4 } from 'ai/test'
import { z } from 'zod'
import { PrivateThreadService, withoutScreenshotImages } from './private-threads'
import { privateComputerTools, SCREENSHOT_NOT_KEPT } from './private-threads-tools'
import { LocalMcpServers } from './private-threads-local-mcp'
import type { LocalToolExecutor } from './local-tools'
import { PrivateThreadStore } from './private-threads-store'
import type { PrivateEvent, PrivateUIMessage } from './private-threads-protocol'

const owner = { userId: 'user-1', workspaceId: 'ws-1' }
const usage = { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1, text: 1, reasoning: 0 } }
const finish = (reason: 'stop' | 'tool-calls'): LanguageModelV4StreamPart => ({ type: 'finish', finishReason: { unified: reason, raw: reason }, usage })
const reply = (text: string): LanguageModelV4StreamPart[] => [
  { type: 'text-start', id: 't' }, { type: 'text-delta', id: 't', delta: text }, { type: 'text-end', id: 't' }, finish('stop'),
]
const toolCall = (toolName: string, input: unknown): LanguageModelV4StreamPart[] => [
  { type: 'tool-call', toolCallId: `call-${toolName}`, toolName, input: JSON.stringify(input) }, finish('tool-calls'),
]

/** A model that answers each call with the next scripted step. */
function scripted(steps: LanguageModelV4StreamPart[][], gate?: Promise<void>) {
  let index = 0
  return new MockLanguageModelV4({
    doStream: async ({ abortSignal }) => {
      const parts = steps[Math.min(index++, steps.length - 1)]!
      return { stream: new ReadableStream<LanguageModelV4StreamPart>({
        async start(controller) {
          if (gate) await Promise.race([gate, new Promise(resolve => abortSignal?.addEventListener('abort', resolve))])
          if (abortSignal?.aborted) { controller.error(abortSignal.reason); return }
          parts.forEach(part => controller.enqueue(part))
          controller.close()
        },
      }) }
    },
  })
}

async function fixture(model: MockLanguageModelV4, extra: Partial<ConstructorParameters<typeof PrivateThreadService>[0]> = {}, sendExtra: Record<string, unknown> = {}) {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'overlay-private-')))
  const store = new PrivateThreadStore(join(base, 'private.sqlite'))
  const events: PrivateEvent[] = []
  let settle: () => void = () => undefined
  const turnEnded = () => new Promise<PrivateEvent>(resolve => {
    settle = () => { const last = events.at(-1); if (last?.kind === 'turn' && last.state !== 'running') resolve(last) }
  })
  const service = new PrivateThreadService({
    store, stateDirectory: join(base, 'state'), createModel: () => model,
    emit: event => { events.push(event); settle() },
    ...extra,
  })
  await service.handle({ method: 'create', owner, threadId: 'p1', agentId: 'agent-1', title: 'New thread', folder: base, model: null })
  const user = (text: string): PrivateUIMessage => ({ id: `u-${text.length}`, role: 'user', parts: [{ type: 'text', text }] })
  const send = async (messages: PrivateUIMessage[], approvalMode: 'ask' | 'auto' = 'ask') => {
    const ended = turnEnded()
    await service.handle({
      method: 'send', owner, threadId: 'p1', turnId: `turn-${events.length}`, messages,
      model: { provider: 'anthropic', modelId: 'claude-test', apiKey: 'sk-test' },
      agent: { name: 'Atlas', instructions: 'Be brief.' }, roots: [base], approvalMode, ...sendExtra,
    })
    return await ended
  }
  return { base, store, service, events, user, send, cleanup: async () => { store.close(); await rm(base, { recursive: true, force: true }) } }
}

test('private turn: tool result, streamed chunks, saved transcript and title', async () => {
  let base = ''
  const model = new MockLanguageModelV4({
    doStream: async ({ prompt }) => {
      const sawResult = prompt.some(message => message.role === 'tool')
      const parts = sawResult ? reply('Wrote the file.') : toolCall('computer_write_file', { path: join(base, 'notes.txt'), contents: 'hello' })
      return { stream: new ReadableStream({ start(c) { parts.forEach(p => c.enqueue(p)); c.close() } }) }
    },
  })
  const f = await fixture(model)
  base = f.base
  try {
    const ended = await f.send([f.user('Write hello to notes.txt')])
    assert.deepEqual(ended.kind === 'turn' && [ended.state, ended.error], ['finished', undefined])
    assert.equal(await readFile(join(f.base, 'notes.txt'), 'utf8'), 'hello')
    assert.ok(f.events.some(event => event.kind === 'chunk' && event.chunk.type === 'text-delta'))
    const { thread, messages, running } = await f.service.handle({ method: 'get', owner, threadId: 'p1' })
    assert.equal(running, false)
    assert.equal(thread.title, 'Write hello to notes.txt')
    assert.equal(thread.model, 'anthropic/claude-test')
    assert.equal(messages.length, 2)
    const parts = messages[1]!.parts
    assert.ok(parts.some(part => part.type === 'tool-computer_write_file' && 'state' in part && part.state === 'output-available'))
    assert.ok(parts.some(part => part.type === 'text' && part.text === 'Wrote the file.'))
  } finally { await f.cleanup() }
})

test('computer_exec waits for approval in ask mode and runs after the person approves', async () => {
  const model = new MockLanguageModelV4({
    doStream: async ({ prompt }) => {
      const sawResult = prompt.some(message => message.role === 'tool' && message.content.some(part => part.type === 'tool-result'))
      const parts = sawResult ? reply('Done.') : toolCall('computer_exec', { command: 'echo private-ok' })
      return { stream: new ReadableStream({ start(c) { parts.forEach(p => c.enqueue(p)); c.close() } }) }
    },
  })
  const f = await fixture(model)
  try {
    const first = await f.send([f.user('Run echo')])
    assert.equal(first.kind === 'turn' && first.state, 'finished')
    let { messages } = await f.service.handle({ method: 'get', owner, threadId: 'p1' })
    const assistant = messages[1]!
    const pending = assistant.parts.find(part => part.type === 'tool-computer_exec') as { state: string; approval?: { id: string } }
    assert.equal(pending.state, 'approval-requested')

    const approved: PrivateUIMessage = {
      ...assistant,
      parts: assistant.parts.map(part => part.type === 'tool-computer_exec'
        ? { ...part, state: 'approval-responded', approval: { ...(part as { approval: object }).approval, approved: true } } as typeof part
        : part),
    }
    const second = await f.send([messages[0]!, approved])
    assert.deepEqual(second.kind === 'turn' && [second.state, second.error], ['finished', undefined])
    ;({ messages } = await f.service.handle({ method: 'get', owner, threadId: 'p1' }))
    const ran = messages[1]!.parts.find(part => part.type === 'tool-computer_exec') as { state: string; output?: { stdout?: string } }
    assert.equal(ran.state, 'output-available')
    assert.match(String(ran.output?.stdout), /private-ok/)
    assert.ok(messages[1]!.parts.some(part => part.type === 'text' && part.text === 'Done.'))
  } finally { await f.cleanup() }
})

test('Stop ends a running turn and keeps the question', async () => {
  const f = await fixture(scripted([reply('never')], new Promise(() => undefined)))
  try {
    const ended = f.send([f.user('Wait forever')])
    await new Promise(resolve => setTimeout(resolve, 50))
    assert.deepEqual(await f.service.handle({ method: 'stop', owner, threadId: 'p1' }), { stopped: true })
    const last = await ended
    assert.equal(last.kind === 'turn' && last.state, 'stopped')
    const { messages, running } = await f.service.handle({ method: 'get', owner, threadId: 'p1' })
    assert.equal(running, false)
    assert.equal(messages[0]!.role, 'user')
  } finally { await f.cleanup() }
})

test('threads belong to one person in one workspace', async () => {
  const f = await fixture(scripted([reply('hi')]))
  try {
    const other = { userId: 'user-2', workspaceId: 'ws-1' }
    assert.deepEqual((await f.service.handle({ method: 'list', owner: other })).threads, [])
    await assert.rejects(f.service.handle({ method: 'get', owner: other, threadId: 'p1' }), /not on this computer/)
    assert.deepEqual(await f.service.handle({ method: 'delete', owner: other, threadId: 'p1' }), { deleted: false })
    assert.equal((await f.service.handle({ method: 'list', owner })).threads.length, 1)
    assert.deepEqual(await f.service.handle({ method: 'delete', owner, threadId: 'p1' }), { deleted: true })
    assert.deepEqual((await f.service.handle({ method: 'list', owner })).threads, [])
  } finally { await f.cleanup() }
})

test('requests are validated: folders must be absolute', async () => {
  const f = await fixture(scripted([reply('hi')]))
  try {
    await assert.rejects(f.service.handle({ method: 'create', owner, threadId: 'p2', agentId: 'a', title: 'x', folder: 'relative/path', model: null }))
  } finally { await f.cleanup() }
})

test('the agent\'s Overlay tools join the turn and the connection closes when it ends', async () => {
  const connected: unknown[] = []
  let closed = 0
  let instructions = ''
  const model = new MockLanguageModelV4({
    doStream: async ({ prompt }) => {
      instructions = prompt.filter(message => message.role === 'system').map(message => String(message.content)).join('\n')
      const sawResult = prompt.some(message => message.role === 'tool')
      const parts = sawResult ? reply('You prefer tea.') : toolCall('search_memory', { query: 'drink' })
      return { stream: new ReadableStream({ start(c) { parts.forEach(p => c.enqueue(p)); c.close() } }) }
    },
  })
  const access = { url: 'https://overlay.example/api/mcp', token: 'ovmcu_t_test.sig' }
  const f = await fixture(model, {
    connectOverlayTools: async (given) => {
      connected.push(given)
      return {
        tools: { search_memory: tool({ inputSchema: z.object({ query: z.string() }), execute: async () => ({ memories: ['Prefers tea'] }) }) },
        instructions: 'Overlay tools act on the person\'s Overlay workspace.',
        close: async () => { closed++ },
      }
    },
  }, { overlay: access })
  try {
    const ended = await f.send([f.user('What do I drink?')])
    assert.equal(ended.kind === 'turn' && ended.state, 'finished')
    assert.deepEqual(connected, [access])
    assert.equal(closed, 1)
    assert.match(instructions, /Overlay tools act on/)
    const { messages } = await f.service.handle({ method: 'get', owner, threadId: 'p1' })
    assert.ok(messages[1]!.parts.some(part => part.type === 'tool-search_memory' && 'state' in part && part.state === 'output-available'))
  } finally { await f.cleanup() }
})

test('a turn runs with this computer\'s tools when Overlay\'s are unavailable, and the token stays out of the log', async () => {
  const logs: string[] = []
  const model = scripted([reply('Hello.')])
  const f = await fixture(model, {
    log: message => logs.push(message),
    connectOverlayTools: async (_access, options) => { options.onUnavailable?.('401 for ovmcu_t_secretvalue.sig'); return null },
  }, { overlay: { url: 'https://overlay.example/api/mcp', token: 'ovmcu_t_secretvalue.sig' } })
  try {
    const ended = await f.send([f.user('Hi')])
    assert.equal(ended.kind === 'turn' && ended.state, 'finished')
    assert.equal(logs.length, 1)
    assert.ok(!logs[0]!.includes('secretvalue'))
  } finally { await f.cleanup() }
})

test('tools of an MCP server on this computer join the turn, ask first, and stop with the host', async () => {
  let instructions = ''
  const model = new MockLanguageModelV4({
    doStream: async ({ prompt }) => {
      instructions = prompt.filter(message => message.role === 'system').map(message => String(message.content)).join('\n')
      const sawResult = prompt.some(message => message.role === 'tool' && message.content.some(part => part.type === 'tool-result'))
      const parts = sawResult ? reply('Greeted.') : toolCall('Fixture__greet', { name: 'Ada' })
      return { stream: new ReadableStream({ start(c) { parts.forEach(p => c.enqueue(p)); c.close() } }) }
    },
  })
  const localMcp = new LocalMcpServers()
  const server = {
    id: 'srv-1', name: 'Fixture', command: process.execPath,
    args: [fileURLToPath(new URL('./fixtures/local-mcp-server.mjs', import.meta.url))], env: { FIXTURE_GREETING: 'Ahoy' },
  }
  const f = await fixture(model, { localMcp }, { localMcp: [server] })
  try {
    const asked = await f.send([f.user('Greet Ada')])
    assert.equal(asked.kind === 'turn' && asked.state, 'finished')
    assert.match(instructions, /MCP servers the person runs on this computer/)
    let { messages } = await f.service.handle({ method: 'get', owner, threadId: 'p1' })
    const pending = messages[1]!.parts.find(part => part.type === 'tool-Fixture__greet') as { state: string }
    assert.equal(pending.state, 'approval-requested')

    await f.service.handle({ method: 'delete', owner, threadId: 'p1' })
    await f.service.handle({ method: 'create', owner, threadId: 'p1', agentId: 'agent-1', title: 'New thread', folder: f.base, model: null })
    const ran = await f.send([f.user('Greet Ada')], 'auto')
    assert.deepEqual(ran.kind === 'turn' && [ran.state, ran.error], ['finished', undefined])
    ;({ messages } = await f.service.handle({ method: 'get', owner, threadId: 'p1' }))
    const result = messages[1]!.parts.find(part => part.type === 'tool-Fixture__greet') as { state: string; output?: unknown }
    assert.equal(result.state, 'output-available')
    assert.match(JSON.stringify(result.output), /Ahoy, Ada/)
    assert.deepEqual(localMcp.running(), ['srv-1'], 'the server stays up between turns')
    assert.deepEqual((await f.service.handle({ method: 'mcpCheck', server })).tools.map(entry => entry.name), ['greet', 'pid'])
    await f.service.shutdown()
    assert.deepEqual(localMcp.running(), [])
  } finally { await f.cleanup() }
})

test('Overlay tools need an https address', async () => {
  const f = await fixture(scripted([reply('Hi.')]), {}, { overlay: { url: 'http://overlay.example/api/mcp', token: 't' } })
  try {
    await assert.rejects(f.send([f.user('Hi')]), /https/)
  } finally { await f.cleanup() }
})

test('a long thread is summarized before it fills the context window, and later turns start from the summary', async () => {
  const prompts: string[] = []
  const summaries: string[] = []
  const model = new MockLanguageModelV4({
    doGenerate: async ({ prompt }) => {
      summaries.push(JSON.stringify(prompt))
      return {
        content: [{ type: 'text', text: 'Earlier: the person is planning a trip to Lisbon in March and prefers trains.' }],
        finishReason: { unified: 'stop', raw: 'stop' }, usage, warnings: [],
      }
    },
    doStream: async ({ prompt }) => {
      prompts.push(JSON.stringify(prompt))
      const parts = reply('Noted.')
      return { stream: new ReadableStream({ start(c) { parts.forEach(p => c.enqueue(p)); c.close() } }) }
    },
  })
  const f = await fixture(model, { contextWindow: 20_000 })
  const said = (id: string, role: 'user' | 'assistant', text: string): PrivateUIMessage => ({ id, role, parts: [{ type: 'text', text }] })
  const old = 'OLD-HISTORY '.repeat(500)
  const history = [
    said('m1', 'user', `Plan a trip to Lisbon. ${old}`), said('m2', 'assistant', `Sure. ${old}`),
    said('m3', 'user', `I prefer trains. ${old}`), said('m4', 'assistant', `Trains it is. ${old}`),
    said('m5', 'user', `March works. ${old}`), said('m6', 'assistant', `March it is. ${old}`),
  ]
  try {
    const first = await f.send([...history, said('m7', 'user', 'What did we decide?')])
    assert.deepEqual(first.kind === 'turn' && [first.state, first.error], ['finished', undefined])
    assert.equal(summaries.length, 1)
    assert.match(summaries[0]!, /Summarize the supplied history/)
    assert.match(prompts.at(-1)!, /Summary of the earlier part of this conversation/)
    assert.ok(!prompts.at(-1)!.includes('Plan a trip to Lisbon'), 'summarized messages are not sent again')
    assert.match(prompts.at(-1)!, /What did we decide\?/)
    assert.deepEqual(f.store.summary('p1'), {
      summary: 'Earlier: the person is planning a trip to Lisbon in March and prefers trains.',
      throughMessageId: 'm6',
    })

    const { messages } = await f.service.handle({ method: 'get', owner, threadId: 'p1' })
    assert.equal(messages.length, 8, 'the transcript on disk stays complete')
    const second = await f.send([...messages, said('m9', 'user', 'And the hotel?')])
    assert.equal(second.kind === 'turn' && second.state, 'finished')
    assert.equal(summaries.length, 1, 'the saved summary is reused')
    assert.match(prompts.at(-1)!, /planning a trip to Lisbon in March/)
    assert.ok(!prompts.at(-1)!.includes('OLD-HISTORY'))
    assert.match(prompts.at(-1)!, /What did we decide\?/)
  } finally { await f.cleanup() }
})

test('a thread survives quitting mid-turn and reopening, up to its last finished step', async () => {
  let base = ''
  let calls = 0
  const model = new MockLanguageModelV4({
    doStream: async ({ abortSignal }) => {
      calls++
      if (calls === 1) {
        const parts = toolCall('computer_write_file', { path: join(base, 'draft.txt'), contents: 'step one' })
        return { stream: new ReadableStream({ start(c) { parts.forEach(p => c.enqueue(p)); c.close() } }) }
      }
      return { stream: new ReadableStream<LanguageModelV4StreamPart>({
        async start(controller) {
          await new Promise(resolve => abortSignal?.addEventListener('abort', resolve))
          controller.error(abortSignal?.reason)
        },
      }) }
    },
  })
  const f = await fixture(model)
  base = f.base
  try {
    void f.send([f.user('Draft it')], 'auto')
    for (let waited = 0; waited < 5_000 && calls < 2; waited += 20) await new Promise(resolve => setTimeout(resolve, 20))
    await new Promise(resolve => setTimeout(resolve, 100))
    await f.service.shutdown()
    f.store.close()

    const reopened = new PrivateThreadStore(join(f.base, 'private.sqlite'))
    try {
      const service = new PrivateThreadService({ store: reopened, stateDirectory: join(f.base, 'state'), emit: () => undefined })
      const { thread, messages, running } = await service.handle({ method: 'get', owner, threadId: 'p1' })
      assert.equal(thread.title, 'Draft it')
      assert.equal(running, false)
      assert.equal(messages[0]!.role, 'user')
      const write = messages[1]?.parts.find(part => part.type === 'tool-computer_write_file') as { state?: string } | undefined
      assert.equal(write?.state, 'output-available')
      assert.equal(await readFile(join(f.base, 'draft.txt'), 'utf8'), 'step one')
    } finally { reopened.close() }
  } finally { await rm(f.base, { recursive: true, force: true }) }
})

test('screenshot images of finished turns are not kept or sent again', () => {
  const shot = { type: 'tool-computer_screenshot', toolCallId: 's1', state: 'output-available', input: {},
    output: { width: 10, height: 10, mediaType: 'image/jpeg', imageBase64: 'AAAA' } }
  const turn = (id: string): PrivateUIMessage => ({ id, role: 'assistant', parts: [shot as never] })
  const messages = [f_user('look'), turn('a1'), f_user('again'), turn('a2')]
  const stripped = withoutScreenshotImages(messages, { keepLast: true })
  assert.deepEqual((stripped[1]!.parts[0] as { output: object }).output, { width: 10, height: 10, mediaType: 'image/jpeg', message: SCREENSHOT_NOT_KEPT })
  assert.equal(stripped[3], messages[3], 'a turn that is continuing keeps its images')
  assert.ok(!JSON.stringify(withoutScreenshotImages(messages, { keepLast: false })).includes('AAAA'))
})

function f_user(text: string): PrivateUIMessage {
  return { id: `u-${text}`, role: 'user', parts: [{ type: 'text', text }] }
}

test('computer tools follow the platform and the shared approval rules', async () => {
  const executor = {} as LocalToolExecutor
  const tools = (platform: NodeJS.Platform, approvalMode: 'ask' | 'auto' = 'ask') =>
    privateComputerTools({ executor, approvalMode, abortSignal: new AbortController().signal, platform })
  const base = ['computer_exec', 'computer_list_files', 'computer_read_file', 'computer_terminal', 'computer_write_file']
  assert.deepEqual(Object.keys(tools('win32')).sort(), base)
  assert.deepEqual(Object.keys(tools('linux')).sort(), [...base, 'computer_browser', 'computer_open_url'].sort())
  assert.deepEqual(Object.keys(tools('darwin')).sort(),
    [...base, 'computer_browser', 'computer_input', 'computer_open_url', 'computer_screenshot'].sort())
  const asks = async (set: ReturnType<typeof tools>, name: string, input: unknown) => {
    const needsApproval = set[name]!.needsApproval
    return typeof needsApproval === 'function'
      ? await needsApproval(input as never, { toolCallId: 'x', messages: [] } as never)
      : Boolean(needsApproval)
  }
  const mac = tools('darwin')
  assert.equal(await asks(mac, 'computer_browser', { action: 'snapshot' }), false)
  assert.equal(await asks(mac, 'computer_browser', { action: 'type', ref: 'e1', text: 'hi' }), true)
  assert.equal(await asks(mac, 'computer_input', { action: 'click', x: 1, y: 1 }), false)
  assert.equal(await asks(mac, 'computer_input', { action: 'click', x: 1, y: 1, confirm: true }), true)
  assert.equal(await asks(mac, 'computer_terminal', { action: 'read', id: 't-0123456789ab' }), false)
  assert.equal(await asks(mac, 'computer_exec', { command: 'ls' }), true)
  assert.equal(await asks(tools('darwin', 'auto'), 'computer_exec', { command: 'ls' }), false)
})
