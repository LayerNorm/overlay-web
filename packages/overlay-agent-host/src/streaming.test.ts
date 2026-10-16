import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { agentHostCommandSchema, eventBatchSchema, type AgentHostEvent, type EventBatch } from '@layernorm/overlay-agent-bridge-protocol'
import { AgentHostRuntime } from './runtime.js'
import { SqliteHostStateStore } from './state.js'
import { FakeAgentAdapter } from './fake-adapter.js'
import { packEventBatch, shrinkOversizedEvent, TRUNCATED_TEXT_MARKER } from './outbox-packing.js'
import { coalesceTextCheckpoints } from './text-coalescer.js'
import type { NormalizedAgentEvent } from './adapter.js'

const event = (sequence: number, text: string): AgentHostEvent => ({ protocolVersion: 1, eventId: `e-${sequence}`, environmentId: 'env', runId: 'run', occurredAt: sequence, sourceSequence: sequence, type: 'text_checkpoint', payload: { text } })
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'overlay-stream-')); const root = join(dir, 'work'); mkdirSync(root)
  const path = join(dir, 'state.sqlite'); const state = new SqliteHostStateStore(path)
  return { dir, root, path, state, close() { state.close(); rmSync(dir, { recursive: true, force: true }) } }
}

test('random UTF-8 checkpoint batches always pass the real wire schema and preserve ordered sequences', () => {
  let seed = 7
  for (let trial = 0; trial < 100; trial++) {
    const events = Array.from({ length: 100 }, (_, i) => { seed = (seed * 1664525 + 1013904223) >>> 0; return event(i + 1, '\\"\n界🙂'.repeat(seed % 3000)) })
    let remaining = events
    while (remaining.length) {
      const packed = packEventBatch('env', remaining); assert.ok(packed.batch)
      eventBatchSchema.parse(packed.batch)
      assert.deepEqual(packed.batch.events, remaining.slice(0, packed.batch.events.length))
      remaining = remaining.slice(packed.batch.events.length)
    }
  }
})

test('an oversized checkpoint is shortened visibly and leaves room for completion', () => {
  const input = event(1, '界🙂\\"\n'.repeat(150_000)); const shrunk = shrinkOversizedEvent(input)
  assert.ok(shrunk); assert.equal(shrunk.type, 'text_checkpoint')
  if (shrunk.type !== 'text_checkpoint') throw Error('unexpected event')
  assert.ok(shrunk.payload.text.endsWith(TRUNCATED_TEXT_MARKER))
  const packed = packEventBatch('env', [shrunk]); assert.ok(packed.batch); eventBatchSchema.parse(packed.batch)
})

test('coalescing preserves text/tool/permission/terminal order and the exact final text', async () => {
  const emitted: NormalizedAgentEvent[] = []
  const emit = coalesceTextCheckpoints(async e => { emitted.push(e) })
  let text = ''
  for (let i = 0; i < 1500; i++) { text += 'abcdefghijklmnopqrst'; await emit({ type: 'text_checkpoint', payload: { text } }) }
  await emit({ type: 'action', payload: { actionId: 'a', title: 'Read', status: 'started' } })
  await emit({ type: 'completed', payload: { usage: {} } })
  assert.ok(emitted.length < 25)
  assert.deepEqual(emitted.slice(-3).map(e => e.type), ['text_checkpoint', 'action', 'completed'])
  const final = emitted.at(-3); assert.equal(final?.type === 'text_checkpoint' && final.payload.text, text)
})

test('a short checkpoint flushes on the timer without waiting for the next event', async () => {
  const emitted: NormalizedAgentEvent[] = []
  const emit = coalesceTextCheckpoints(async e => { emitted.push(e) }, { intervalMs: 10 })
  await emit({ type: 'text_checkpoint', payload: { text: 'hello' } })
  await new Promise(resolve => setTimeout(resolve, 30)); assert.equal(emitted.length, 1)
})

test('a queued tool captures preceding text before concurrent later text arrives', async () => {
  const emitted: NormalizedAgentEvent[] = []
  let release!: () => void
  const blocked = new Promise<void>(resolve => { release = resolve })
  const emit = coalesceTextCheckpoints(async e => { await blocked; emitted.push(e) })
  await emit({ type: 'text_checkpoint', payload: { text: 'before' } })
  const tool = emit({ type: 'action', payload: { actionId: 'a', title: 'Read', status: 'started' } })
  await emit({ type: 'text_checkpoint', payload: { text: 'before after' } })
  const done = emit({ type: 'completed', payload: { usage: {} } })
  release()
  await Promise.all([tool, done])
  assert.deepEqual(emitted.map(e => e.type), ['text_checkpoint', 'action', 'text_checkpoint', 'completed'])
  assert.equal(emitted[0]?.type === 'text_checkpoint' && emitted[0].payload.text, 'before')
  assert.equal(emitted[2]?.type === 'text_checkpoint' && emitted[2].payload.text, 'before after')
})

test('retry after a lost acknowledgement never rewrites an attempted sequence, including after restart', () => {
  const f = fixture(); let state = f.state
  try {
    const { sourceSequence: _, ...first } = event(1, 'first'); state.appendOrReplaceTextCheckpoint(first, 0)
    state.markUploadAttempt(state.pendingEvents(100)); state.close(); state = new SqliteHostStateStore(f.path)
    state.appendOrReplaceTextCheckpoint({ ...first, eventId: 'second', payload: { text: 'first + second' } }, 0)
    const pending = state.pendingEvents(100)
    assert.equal(pending.length, 2); assert.equal(pending[0]?.eventId, 'e-1'); assert.equal(pending[1]?.sourceSequence, 2)
  } finally { state.close(); rmSync(f.dir, { recursive: true, force: true }) }
})

test('a pre-wedged SQLite outbox drains with a >600 KB answer and terminal event after transient failures', async () => {
  const f = fixture(); const accepted: EventBatch[] = []; let failures = 3
  try {
    for (let i = 0; i < 100; i++) { const { sourceSequence: _, ...e } = event(i + 1, 'x'.repeat(10_000)); f.state.appendEvent(e) }
    const { sourceSequence: _, ...big } = event(101, 'x'.repeat(650_000)); f.state.appendEvent(big)
    f.state.appendEvent({ ...big, eventId: 'done', type: 'completed', payload: { usage: {} } })
    const runtime = new AgentHostRuntime({ environmentId: 'env', workspaceId: 'ws', filesystem: { mode: 'selected_roots', roots: [f.root] }, adapters: [], state: f.state,
      controlPlane: { async pollCommands() { return { commands: [] } }, async acknowledgeCommand() {}, async uploadEvents(batch) {
        if (failures-- > 0) throw Error('temporary outage'); eventBatchSchema.parse(batch); accepted.push(batch)
        return { protocolVersion: 1, accepted: true, acknowledgedSequence: batch.events.at(-1)!.sourceSequence }
      } } })
    for (let i = 0; i < 3; i++) await assert.rejects(runtime.flushOutbox(), /temporary outage/)
    await runtime.flushOutbox(); runtime.stopBackgroundUploads()
    assert.equal(f.state.outboxSize(), 0); assert.equal(accepted.flatMap(b => b.events).at(-1)?.type, 'completed')
    assert.deepEqual(accepted.flatMap(b => b.events).map(e => e.sourceSequence), Array.from({ length: 102 }, (_, i) => i + 1))
  } finally { f.close() }
})

test('a network upload cannot block dispatching the next Stop command', async () => {
  const f = fixture(); let finishUpload: (() => void) | undefined; let commandIndex = 0
  const commands = [agentHostCommandSchema.parse({ protocolVersion: 1, commandId: 'start', workspaceId: 'ws', environmentId: 'env', runId: 'run', sequence: 1, type: 'start', issuedAt: 1,
    payload: { bindingId: 'binding', adapterId: 'fake', workingDirectory: f.root, prompt: 'hello', metadata: {} } }),
  agentHostCommandSchema.parse({ protocolVersion: 1, commandId: 'stop', workspaceId: 'ws', environmentId: 'env', runId: 'run', sequence: 2, type: 'cancel', issuedAt: 2, payload: {} })]
  const runtime = new AgentHostRuntime({ environmentId: 'env', workspaceId: 'ws', filesystem: { mode: 'selected_roots', roots: [f.root] }, state: f.state, adapters: [new FakeAgentAdapter()],
    controlPlane: { async pollCommands({signal}) {
      if (commandIndex === 1 && !f.state.getProcessedCommand('start')) return new Promise(resolve => {signal?.addEventListener('abort', () => resolve({commands: []}), {once: true})})
      return { commands: [commands[commandIndex++]!] }
    }, async acknowledgeCommand() {}, async uploadEvents(batch) {
      await new Promise<void>(resolve => { finishUpload = resolve }); return { protocolVersion: 1, accepted: true, acknowledgedSequence: batch.events.at(-1)!.sourceSequence }
    } } })
  try {
    await runtime.pollOnce(0); await runtime.pollOnce(0)
    assert.equal(f.state.commandCursor(), 2)
    assert.ok(f.state.pendingEvents(20).some(event => event.type === 'cancelled'))
    runtime.stopBackgroundUploads(); finishUpload?.()
    // Drain the already started pass without another blocked request.
    const flushing = runtime.flushOutbox(); for (let i = 0; i < 10; i++) { finishUpload?.(); await new Promise(resolve => setImmediate(resolve)) }
    await flushing
  } finally { runtime.stopBackgroundUploads(); f.close() }
})

test('30 KB in 20-character chunks survives upload failures without changing the final answer', async () => {
  const f = fixture(); const received: AgentHostEvent[] = []; let failures = 3
  const answer = 'abcdefghijklmnopqrst'.repeat(1500)
  class StreamingAdapter extends FakeAgentAdapter {
    override async start(input: Parameters<FakeAgentAdapter['start']>[0], emit: Parameters<FakeAgentAdapter['start']>[1]) {
      const session = await super.start(input, emit)
      return { ...session, prompt: async () => {
        for (let i = 20; i <= answer.length; i += 20) await emit({ type: 'text_checkpoint', payload: { text: answer.slice(0, i) } })
        await emit({ type: 'completed', payload: { usage: {} } })
      } }
    }
  }
  const start = agentHostCommandSchema.parse({ protocolVersion: 1, workspaceId: 'ws', environmentId: 'env', runId: 'run', commandId: 'start', sequence: 1, issuedAt: 1, type: 'start',
    payload: { bindingId: 'binding', adapterId: 'fake', workingDirectory: f.root, prompt: 'write', metadata: {} } })
  const runtime = new AgentHostRuntime({ environmentId: 'env', workspaceId: 'ws', filesystem: { mode: 'selected_roots', roots: [f.root] }, adapters: [new StreamingAdapter()], state: f.state,
    controlPlane: { async pollCommands() { return { commands: [start] } }, async acknowledgeCommand() {}, async uploadEvents(batch) {
      if (failures-- > 0) throw Error('temporary outage'); eventBatchSchema.parse(batch); received.push(...batch.events)
      return { protocolVersion: 1, accepted: true, acknowledgedSequence: batch.events.at(-1)!.sourceSequence }
    } } })
  try {
    await runtime.pollOnce(0)
    const deadline = Date.now() + 5000
    while (!received.some(e => e.type === 'completed')) {
      assert.ok(Date.now() < deadline, 'the background uploader must eventually recover')
      await new Promise(resolve => setTimeout(resolve, 20))
    }
    const checkpoints = received.filter(e => e.type === 'text_checkpoint')
    assert.equal(checkpoints.at(-1)?.payload.text, answer)
    assert.deepEqual(received.map(e => e.sourceSequence), Array.from({ length: received.length }, (_, i) => i + 1))
    assert.equal(f.state.outboxSize(), 0)
  } finally { runtime.stopBackgroundUploads(); f.close() }
})

test('shortening UTF-8 checkpoints never splits a surrogate pair at the transport boundary', () => {
  for (let budget = 2048; budget < 2070; budget++) {
    const shrunk = shrinkOversizedEvent(event(1, '🙂'.repeat(10000)), budget)
    assert.ok(shrunk?.type === 'text_checkpoint')
    for (const character of shrunk.payload.text) {
      const unit = character.charCodeAt(0)
      assert.ok(character.length > 1 || unit < 0xd800 || unit > 0xdfff, 'the output must contain no lone surrogate')
    }
  }
})

for (const fenced of [false, true]) test(`a lost acknowledgement retries the same batch across restart (${fenced ? 'fenced' : 'legacy'})`, async () => {
  const f = fixture()
  let state = f.state
  let cursor = 0
  let requests = 0
  let rejections = 0
  const sent: number[][] = []
  const execution = fenced ? { attemptId: 'attempt', generation: 1 } : undefined
  const append = (text: string) => {
    const { sourceSequence: _, ...input } = event(1, text)
    state.appendEvent({ ...input, eventId: text, ...(execution ? { execution } : {}) })
  }
  const runtime = () => new AgentHostRuntime({ environmentId: 'env', workspaceId: 'ws', filesystem: { mode: 'selected_roots', roots: [f.root] }, adapters: [], state,
    controlPlane: { async pollCommands() { return { commands: [] } }, async acknowledgeCommand() {}, async uploadEvents(batch) {
      sent.push(batch.events.map(event => event.sourceSequence))
      const first = batch.events[0]!.sourceSequence
      const last = batch.events.at(-1)!.sourceSequence
      if (++requests === 1) { cursor = last; append('later text'); throw Error('acknowledgement lost') }
      if (first <= cursor && last > cursor) { rejections++; return { protocolVersion: 1, accepted: false, expectedSequence: cursor + 1 } }
      cursor = Math.max(cursor, last)
      return { protocolVersion: 1, accepted: true, acknowledgedSequence: cursor }
    } } })
  try {
    append('first text')
    await assert.rejects(runtime().flushOutbox(), /acknowledgement lost/)
    state.close(); state = new SqliteHostStateStore(f.path)
    assert.deepEqual(state.pendingEvents(100).map(event => event.sourceSequence), [1, 2])
    assert.deepEqual(state.pendingUploadEvents(100).map(event => event.sourceSequence), [1])
    await runtime().flushOutbox()
    assert.deepEqual(sent, [[1], [1], [2]])
    assert.equal(rejections, 0)
    assert.equal(state.outboxSize(), 0)
  } finally { state.close(); rmSync(f.dir, { recursive: true, force: true }) }
})

test('an upgraded byte budget accepts an already committed acknowledgement within its attempted watermark', async () => {
  const f = fixture()
  try {
    for (let index = 1; index <= 3; index++) {
      const { sourceSequence: _, ...input } = event(index, 'x'.repeat(172000))
      f.state.appendEvent(input)
    }
    f.state.markUploadAttempt(f.state.pendingEvents(100))
    const runtime = new AgentHostRuntime({ environmentId: 'env', workspaceId: 'ws', filesystem: { mode: 'selected_roots', roots: [f.root] }, adapters: [], state: f.state,
      controlPlane: { async pollCommands() { return { commands: [] } }, async acknowledgeCommand() {}, async uploadEvents(batch) {
        assert.ok(batch.events.length < 3, 'the new packing headroom splits the formerly accepted batch')
        return { protocolVersion: 1, accepted: true, acknowledgedSequence: 3 }
      } } })
    await runtime.flushOutbox()
    assert.equal(f.state.outboxSize(), 0)
  } finally { f.close() }
})
