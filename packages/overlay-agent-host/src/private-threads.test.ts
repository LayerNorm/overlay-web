import assert from 'node:assert/strict'
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import type { LanguageModelV4StreamPart } from '@ai-sdk/provider'
import { MockLanguageModelV4 } from 'ai/test'
import { PrivateThreadService } from './private-threads'
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

async function fixture(model: MockLanguageModelV4) {
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
  })
  await service.handle({ method: 'create', owner, threadId: 'p1', agentId: 'agent-1', title: 'New thread', folder: base, model: null })
  const user = (text: string): PrivateUIMessage => ({ id: `u-${text.length}`, role: 'user', parts: [{ type: 'text', text }] })
  const send = async (messages: PrivateUIMessage[], approvalMode: 'ask' | 'auto' = 'ask') => {
    const ended = turnEnded()
    await service.handle({
      method: 'send', owner, threadId: 'p1', turnId: `turn-${events.length}`, messages,
      model: { provider: 'anthropic', modelId: 'claude-test', apiKey: 'sk-test' },
      agent: { name: 'Atlas', instructions: 'Be brief.' }, roots: [base], approvalMode,
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
