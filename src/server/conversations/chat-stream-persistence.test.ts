import assert from 'node:assert/strict'
import test from 'node:test'
import type { TextStreamPart, ToolSet } from '@/server/ai/sdk'
import { createPersistedTextDeltaTransform } from './chat-stream-persistence'

test('persisted stream transform batches text deltas without changing the stream', async () => {
  const persisted: string[] = []
  let stopped = false
  const transform = createPersistedTextDeltaTransform({
    appendTextDelta: async (textDelta) => {
      persisted.push(textDelta)
      return true
    },
    flushIntervalMs: 60_000,
  })({ tools: {}, stopStream: () => { stopped = true } })
  const output = consume(transform.readable)
  const writer = transform.writable.getWriter()
  await writer.write(textDelta('hello '))
  await writer.write(textDelta('world'))
  await writer.write({ type: 'finish', finishReason: 'stop', rawFinishReason: 'stop', totalUsage: {} } as TextStreamPart<ToolSet>)
  await writer.close()

  assert.deepEqual(persisted, ['hello world'])
  assert.equal(stopped, false)
  assert.equal((await output).length, 3)
})

test('persisted stream transform stops model consumption after a remote stop', async () => {
  let stopped = false
  const transform = createPersistedTextDeltaTransform({
    appendTextDelta: async () => false,
    flushIntervalMs: 60_000,
  })({ tools: {}, stopStream: () => { stopped = true } })
  const output = consume(transform.readable)
  const writer = transform.writable.getWriter()
  await writer.write(textDelta('partial'))
  await writer.close()
  await output

  assert.equal(stopped, true)
})

function textDelta(text: string): TextStreamPart<ToolSet> {
  return { type: 'text-delta', id: 'text-1', text }
}

async function consume(stream: ReadableStream<TextStreamPart<ToolSet>>) {
  const chunks: Array<TextStreamPart<ToolSet>> = []
  const reader = stream.getReader()
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
  }
  return chunks
}
