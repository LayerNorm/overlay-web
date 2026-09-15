import 'server-only'

import assert from 'node:assert/strict'
import test from 'node:test'

import { createHarnessTranscriptWritable } from './transcript-writable'

type Write = Record<string, unknown>

function collect() {
  const text: string[] = []
  const parts: Array<Array<Record<string, unknown>>> = []
  const { writable, snapshot } = createHarnessTranscriptWritable({
    sink: {
      pushText: (delta) => text.push(delta),
      pushParts: (next) => parts.push(next),
    },
    now: () => Date.now(),
  })
  const writer = writable.getWriter()
  return { text, parts, writer, snapshot }
}

async function writeAll(writer: WritableStreamDefaultWriter<Write>, chunks: Write[]) {
  for (const chunk of chunks) await writer.write(chunk)
}

test('text-delta chunks stream through to the sink and accumulate content', async () => {
  const { text, writer, snapshot } = collect()
  await writeAll(writer, [
    { type: 'text-start', id: 't1' },
    { type: 'text-delta', id: 't1', delta: 'Hello ' },
    { type: 'text-delta', id: 't1', delta: 'world' },
    { type: 'text-end', id: 't1' },
    { type: 'finish' },
  ])
  assert.deepEqual(text, ['Hello ', 'world'])
  assert.equal(snapshot().content, 'Hello world')
})

test('tool-input-available opens a tool-invocation part; outputs settle it', async () => {
  const { parts, writer, snapshot } = collect()
  await writeAll(writer, [
    { type: 'tool-input-available', toolCallId: 'call_1', toolName: 'bash', input: { command: 'ls' } },
    { type: 'tool-output-available', toolCallId: 'call_1', output: { stdout: 'a.txt' } },
  ])
  const part = snapshot().parts.find((p) => p.type === 'tool-invocation')
  assert.ok(part)
  const invocation = part.toolInvocation as Record<string, unknown>
  assert.equal(invocation.toolCallId, 'call_1')
  assert.equal(invocation.toolName, 'bash')
  assert.equal(invocation.state, 'output-available')
  assert.deepEqual(invocation.toolInput, { command: 'ls' })
  assert.deepEqual(invocation.toolOutput, { stdout: 'a.txt' })
  // Both the open and the settle pushed a parts snapshot.
  assert.ok(parts.length >= 2)
})

test('tool-output-error and tool-output-denied mark the invocation failed', async () => {
  const { writer, snapshot } = collect()
  await writeAll(writer, [
    { type: 'tool-input-available', toolCallId: 'call_1', toolName: 'bash', input: {} },
    { type: 'tool-output-error', toolCallId: 'call_1', errorText: 'boom' },
    { type: 'tool-input-available', toolCallId: 'call_2', toolName: 'write', input: {} },
    { type: 'tool-output-denied', toolCallId: 'call_2' },
  ])
  const byCall = Object.fromEntries(
    snapshot().parts
      .filter((p) => p.type === 'tool-invocation')
      .map((p) => [(p.toolInvocation as Record<string, unknown>).toolCallId, p]),
  )
  assert.equal((byCall.call_1!.toolInvocation as Record<string, unknown>).state, 'output-error')
  assert.deepEqual((byCall.call_1!.toolInvocation as Record<string, unknown>).toolOutput, { error: 'boom' })
  assert.equal((byCall.call_2!.toolInvocation as Record<string, unknown>).state, 'output-error')
})

test('reasoning accumulates into one part and is marked done at step end', async () => {
  const { writer, snapshot } = collect()
  await writeAll(writer, [
    { type: 'reasoning-start', id: 'r1' },
    { type: 'reasoning-delta', id: 'r1', delta: 'thinking ' },
    { type: 'reasoning-delta', id: 'r1', delta: 'hard' },
    { type: 'reasoning-end', id: 'r1' },
  ])
  const part = snapshot().parts.find((p) => p.type === 'reasoning')
  assert.ok(part)
  assert.equal(part.text, 'thinking hard')
  assert.equal(part.state, 'done')
})

test('a slice seeded with a prior snapshot continues accumulating', async () => {
  const first = collect()
  await writeAll(first.writer, [
    { type: 'text-delta', id: 't1', delta: 'partial ' },
    { type: 'tool-input-available', toolCallId: 'c1', toolName: 'grep', input: {} },
  ])
  const seed = first.snapshot()

  const resumed = createHarnessTranscriptWritable({
    initial: seed,
    sink: { pushText: () => {}, pushParts: () => {} },
  })
  const writer = resumed.writable.getWriter()
  await writeAll(writer, [
    { type: 'tool-output-available', toolCallId: 'c1', output: 'hit' },
    { type: 'text-delta', id: 't2', delta: 'answer' },
  ])
  assert.equal(resumed.snapshot().content, 'partial answer')
  assert.equal(resumed.snapshot().parts.length, 1)
  assert.equal(
    (resumed.snapshot().parts[0]!.toolInvocation as Record<string, unknown>).state,
    'output-available',
  )
})

test('stream scaffolding chunks are ignored', async () => {
  const { text, parts, writer, snapshot } = collect()
  await writeAll(writer, [
    { type: 'start' },
    { type: 'start-step' },
    { type: 'resume-session', sessionId: 's1' },
    { type: 'tool-input-start', toolCallId: 'c1', toolName: 'bash' },
    { type: 'tool-input-delta', toolCallId: 'c1', inputTextDelta: '{"command":' },
    { type: 'data-session', data: {} },
  ])
  assert.deepEqual(text, [])
  assert.deepEqual(parts, [])
  assert.equal(snapshot().content, '')
  assert.equal(snapshot().parts.length, 0)
})
