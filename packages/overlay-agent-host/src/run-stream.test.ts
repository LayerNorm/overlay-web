import assert from 'node:assert/strict'
import test from 'node:test'
import type { NormalizedAgentEvent } from './adapter.js'
import { createRunStream } from './run-stream.js'
import { applyRemoteText } from '../../../src/shared/agents/remote-agent-text.js'

test('an in-flight process probe cannot publish loss after provider completion begins draining', async () => {
  const events: NormalizedAgentEvent[] = []
  let active = true, release: (value: 'lost') => void = () => { throw Error('probe not started') }
  const probe = new Promise<'lost'>(resolve => { release = resolve })
  const stream = createRunStream(async event => { events.push(event) }, {
    streaming: () => true, active: () => active, observe: () => probe, onError: error => { throw error },
  })
  try {
    const pending = stream.heartbeat()
    active = false
    release('lost')
    await pending
    await stream.emit({type: 'text_checkpoint', payload: {text: 'Retained final answer', final: true}})
    await stream.emit({type: 'completed', payload: {usage: {}}})
    assert.deepEqual(events.map(event => event.type), ['text_delta', 'completed'])
    assert.equal(events[0].type === 'text_delta' && events[0].payload.text, 'Retained final answer')
  } finally { release('lost'); stream.stop() }
})

test('a replacement stream appends after the canonical prefix, including corrections and bounded anchors', async () => {
  const prefix = 'Already committed 🙂\n'.repeat(4000)
  for (const streaming of [true, false]) {
    let content = prefix
    const events: NormalizedAgentEvent[] = []
    const stream = createRunStream(async event => {
      events.push(event)
      content = applyRemoteText(content, { ...event, protocolVersion: 1, eventId: 'test', environmentId: 'test', runId: 'test', sourceSequence: events.length, occurredAt: 1 })
    }, { streaming: () => streaming, textBaseOffset: prefix.length, observe: async () => 'live', onError: error => { throw error } })
    try {
      const continuation = '\nContinued 🙃 '.repeat(8000)
      await stream.emit({ type: 'text_checkpoint', payload: { text: continuation, final: true } })
      assert.equal(content, prefix + continuation)
      await stream.emit({ type: 'text_checkpoint', payload: { text: 'corrected continuation ✓', final: true } })
      await stream.emit({ type: 'completed', payload: { usage: {} } })
      assert.equal(content, prefix + 'corrected continuation ✓')
      assert.ok(events.filter(event => event.type === 'text_delta' || event.type === 'text_checkpoint')
        .every(event => event.payload.offset !== undefined && event.payload.offset >= prefix.length))
    } finally { stream.stop() }
  }
})

test('Unicode packet boundaries and provider corrections preserve complete code points', async () => {
  const events: NormalizedAgentEvent[] = []
  const stream = createRunStream(async event => { events.push(event) }, { streaming: () => true, observe: async () => 'live', onError: error => { throw error } })
  try {
    const first = '🙂x'.repeat(40000) + '🙂'
    const corrected = '🙂x'.repeat(40000) + '🙃 changed'
    await stream.emit({ type: 'text_checkpoint', payload: { text: first, final: true } })
    await stream.emit({ type: 'text_checkpoint', payload: { text: corrected, final: true } })
    let result = ''
    for (const event of events) {
      if (event.type !== 'text_delta' && event.type !== 'text_checkpoint') continue
      assert.equal(event.payload.text, Buffer.from(event.payload.text).toString('utf8'), 'packet has an unpaired surrogate')
      const offset = event.payload.offset ?? 0
      assert.equal(result.slice(0, offset), Buffer.from(result.slice(0, offset)).toString('utf8'), 'offset splits a code point')
      if (event.type === 'text_delta') assert.equal(offset, result.length)
      result = result.slice(0, offset) + event.payload.text
    }
    assert.equal(result, corrected)
  } finally { stream.stop() }
})

test('negotiated output sends each text character once with bounded anchors, legacy output remains checkpoints', async () => {
  for (const streaming of [false, true]) {
    const events: NormalizedAgentEvent[] = []
    const stream = createRunStream(async e => { events.push(e) }, { streaming: () => streaming, observe: async () => 'live', onError: error => { throw error } })
    const answer = '🙂 test '.repeat(100000)
    try {
      await stream.emit({ type: 'text_checkpoint', payload: { text: answer, final: true } })
      await stream.emit({ type: 'completed', payload: { usage: {} } })
      if (streaming) {
        const deltas = events.filter(e => e.type === 'text_delta')
        assert.equal(deltas.map(e => e.payload.text).join(''), answer)
        assert.ok(events.filter(e => e.type === 'text_checkpoint').every(e => e.payload.text.length <= 16384))
        let offset = 0; for (const e of deltas) { assert.equal(e.payload.offset, offset); offset += e.payload.text.length }
      } else { assert.equal(events[0]?.type, 'text_checkpoint'); assert.equal(events.length, 2) }
    } finally { stream.stop() }
  }
})

test('a live process with a three-minute open tool gets heartbeats without a false stall, then terminal stops them', async () => {
  const events: NormalizedAgentEvent[] = []; let time = 1000
  const stream = createRunStream(async e => { events.push(e) }, { streaming: () => true, observe: async () => 'live', now: () => time, onError: error => { throw error } })
  try {
    await stream.emit({ type: 'action', payload: { actionId: 'slow', title: 'Long tool', status: 'started' } })
    time += 180000; await stream.heartbeat()
    const heartbeat = events.at(-1)
    assert.equal(heartbeat?.type, 'heartbeat')
    if (heartbeat?.type !== 'heartbeat') throw Error('missing heartbeat')
    assert.equal(heartbeat.payload.stalled, false); assert.equal(heartbeat.payload.openTools[0]?.runningMs, 180000)
    await stream.emit({ type: 'completed', payload: { usage: {} } }); const count = events.length
    await stream.heartbeat(); assert.equal(events.length, count)
  } finally { stream.stop() }
})

test('large provider corrections trim only the changed suffix and remain byte-bounded', async () => {
  const events: NormalizedAgentEvent[] = []
  const stream = createRunStream(async event => { events.push(event) }, { streaming: () => true, observe: async () => 'live', onError: error => { throw error } })
  try {
    await stream.emit({ type: 'text_checkpoint', payload: { text: 'prefix old suffix', final: true } })
    const corrected = 'prefix ' + 'new '.repeat(200000)
    await stream.emit({ type: 'text_checkpoint', payload: { text: corrected, final: true } })
    let result = ''
    for (const event of events) {
      if (event.type === 'text_delta') { assert.equal(event.payload.offset, result.length); result += event.payload.text }
      if (event.type === 'text_checkpoint') result = result.slice(0, event.payload.offset ?? 0) + event.payload.text
    }
    assert.equal(result, corrected)
    assert.ok(events.every(event => new TextEncoder().encode(JSON.stringify(event)).byteLength < 100000))
  } finally { stream.stop() }
})

test('a new host retries capability discovery without streaming against a strict old server', async () => {
  const { mkdtempSync, rmSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const { AgentHostRuntime } = await import('./runtime.js')
  const { SqliteHostStateStore } = await import('./state.js')
  const { ControlPlaneRequestError } = await import('./transport.js')
  const dir = mkdtempSync(join(tmpdir(), 'overlay-negotiation-'))
  const state = new SqliteHostStateStore(join(dir, 'state.sqlite'))
  const attempts: unknown[] = []
  const controller = new AbortController()
  const runtime = new AgentHostRuntime({ environmentId: 'env', workspaceId: 'ws', filesystem: { mode: 'selected_roots', roots: [dir] }, state, adapters: [],
    controlPlane: {
      async updateCapabilities(capabilities) { attempts.push(capabilities); if (capabilities.streaming) throw new ControlPlaneRequestError(400, 'validation_error') },
      async pollCommands() { controller.abort(); return { commands: [] } }, async acknowledgeCommand() {},
      async uploadEvents() { throw Error('no run should upload') },
    } })
  try { await runtime.run(controller.signal); assert.equal(attempts.length, 3); assert.ok(JSON.stringify(attempts[0]).includes('streaming')); assert.ok(!JSON.stringify(attempts[2]).includes('streaming')) }
  finally { runtime.stopBackgroundUploads(); state.close(); rmSync(dir, { recursive: true, force: true }) }
})
