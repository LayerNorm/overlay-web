import assert from 'node:assert/strict'
import test from 'node:test'
import {
  AGENT_STREAM_EVENT_INTERVAL_MS,
  AGENT_STREAM_FLUSH_CHARS,
  AGENT_STREAM_FLUSH_INTERVAL_MS,
  createAgentMessageStream,
  type AgentMessageStreamStore,
} from './agent-message-stream'

type Call = { method: string; args: Record<string, unknown> }

function recordingStore(overrides: Partial<AgentMessageStreamStore> = {}) {
  const calls: Call[] = []
  const store: AgentMessageStreamStore = {
    async startAgentMessage(args) {
      calls.push({ method: 'start', args })
      return 'message_1'
    },
    async appendAgentMessageDelta(args) {
      calls.push({ method: 'append', args })
    },
    async finalizeAgentMessage(args) {
      calls.push({ method: 'finalize', args })
    },
    async failAgentMessage(args) {
      calls.push({ method: 'fail', args })
    },
    ...overrides,
  }
  return { calls, store }
}

function streamFor(store: AgentMessageStreamStore, now: () => number) {
  return createAgentMessageStream({
    actorUserId: 'user_1',
    authorPrincipalId: 'principal_agent',
    clientNonce: 'agent:message_1:agent_1',
    conversationId: 'conversation_1',
    modelId: 'model-x',
    now,
    store,
    turnId: 'agent_message_1_agent_1',
    workspaceId: 'workspace_1',
  })
}

test('the durable row is opened lazily, so an empty turn leaves no bubble', async () => {
  const { calls, store } = recordingStore()
  const stream = streamFor(store, () => 0)

  await stream.finalize({ content: '' })

  assert.deepEqual(calls, [])
  assert.equal(stream.messageId, null)
})

test('text is batched by size and by elapsed time, not written per token', async () => {
  let clock = 0
  const { calls, store } = recordingStore()
  const stream = streamFor(store, () => clock)

  // Below both thresholds: still buffered.
  stream.pushText('a'.repeat(10))
  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(calls.map((call) => call.method), [])

  // Crossing the character threshold flushes without waiting for the interval.
  stream.pushText('b'.repeat(AGENT_STREAM_FLUSH_CHARS))
  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(calls.map((call) => call.method), ['start', 'append'])
  assert.equal(
    calls[1]!.args.contentDelta,
    `${'a'.repeat(10)}${'b'.repeat(AGENT_STREAM_FLUSH_CHARS)}`,
  )

  // A short tail waits for the interval rather than costing another write.
  stream.pushText('c')
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(calls.length, 2)

  clock += AGENT_STREAM_FLUSH_INTERVAL_MS
  stream.pushText('d')
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(calls.length, 3)
  assert.equal(calls[2]!.args.contentDelta, 'cd')
})

test('durable delta events stay coarser than the writes they accompany', async () => {
  let clock = 0
  const { calls, store } = recordingStore()
  const stream = streamFor(store, () => clock)

  for (let index = 0; index < 4; index += 1) {
    stream.pushText('x'.repeat(AGENT_STREAM_FLUSH_CHARS))
    await new Promise((resolve) => setImmediate(resolve))
    clock += AGENT_STREAM_EVENT_INTERVAL_MS / 2
  }

  const appends = calls.filter((call) => call.method === 'append')
  assert.equal(appends.length, 4)
  // Only the writes at or past the event interval publish an event; a polling
  // viewer must not be made to refetch the transcript on every flush.
  const emitted = appends.filter((call) => call.args.emitEvent === true)
  assert.equal(emitted.length, 2)
  assert.ok(AGENT_STREAM_EVENT_INTERVAL_MS > AGENT_STREAM_FLUSH_INTERVAL_MS)
})

test('a parts change always flushes, since tool calls move at step boundaries', async () => {
  const { calls, store } = recordingStore()
  const stream = streamFor(store, () => 0)

  stream.pushText('thinking')
  stream.pushParts([{ type: 'tool-invocation', toolInvocation: { toolName: 'search' } }])
  await new Promise((resolve) => setImmediate(resolve))

  const append = calls.find((call) => call.method === 'append')
  assert.ok(append)
  assert.equal(append.args.contentDelta, 'thinking')
  assert.deepEqual(append.args.parts, [
    { type: 'tool-invocation', toolInvocation: { toolName: 'search' } },
  ])
})

test('finalize writes the authoritative text rather than extending the deltas', async () => {
  const { calls, store } = recordingStore()
  const stream = streamFor(store, () => 0)

  stream.pushText('x'.repeat(AGENT_STREAM_FLUSH_CHARS))
  const messageId = await stream.finalize({
    content: 'the reconciled reply',
    tokens: { input: 10, output: 20 },
  })

  assert.equal(messageId, 'message_1')
  const finalize = calls.find((call) => call.method === 'finalize')
  assert.ok(finalize)
  assert.equal(finalize.args.content, 'the reconciled reply')
  assert.deepEqual(finalize.args.tokens, { input: 10, output: 20 })
})

test('a failed open degrades to no durable row instead of failing the turn', async () => {
  const attempts: Call[] = []
  const { store } = recordingStore({
    async startAgentMessage(args) {
      attempts.push({ method: 'start', args })
      throw new Error('convex unavailable')
    },
  })
  const stream = streamFor(store, () => 0)

  stream.pushText('y'.repeat(AGENT_STREAM_FLUSH_CHARS))
  await new Promise((resolve) => setImmediate(resolve))
  stream.pushText('z'.repeat(AGENT_STREAM_FLUSH_CHARS))
  await new Promise((resolve) => setImmediate(resolve))

  // One attempt, then the stream stops trying; the caller falls back to a
  // single terminal write so the reply still lands.
  assert.equal(attempts.length, 1)
  assert.equal(await stream.finalize({ content: 'reply' }), null)
})

test('a dropped delta does not abort the turn, because finalize rewrites the row', async () => {
  let appendCalls = 0
  const { calls, store } = recordingStore({
    async appendAgentMessageDelta() {
      appendCalls += 1
      throw new Error('transient write failure')
    },
  })
  const stream = streamFor(store, () => 0)

  stream.pushText('w'.repeat(AGENT_STREAM_FLUSH_CHARS))
  await new Promise((resolve) => setImmediate(resolve))

  assert.equal(appendCalls, 1)
  assert.equal(await stream.finalize({ content: 'complete reply' }), 'message_1')
  assert.ok(calls.some((call) => call.method === 'finalize'))
})

test('failing an opened row keeps the partial text visible', async () => {
  const { calls, store } = recordingStore()
  const stream = streamFor(store, () => 0)

  stream.pushText('p'.repeat(AGENT_STREAM_FLUSH_CHARS))
  await new Promise((resolve) => setImmediate(resolve))
  await stream.fail({ content: 'partial' })

  const failed = calls.find((call) => call.method === 'fail')
  assert.ok(failed)
  assert.equal(failed.args.content, 'partial')
})
