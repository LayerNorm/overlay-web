import assert from 'node:assert/strict'
import test from 'node:test'
import { createUiMessageMetadataTransform } from './ui-message-metadata-transform'

type Chunk = Record<string, unknown> & { type: string }

async function run(chunks: Chunk[], metadata: Record<string, unknown> | undefined) {
  const source = new ReadableStream<Chunk>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk)
      controller.close()
    },
  })
  const out: Chunk[] = []
  const reader = source
    .pipeThrough(createUiMessageMetadataTransform(metadata) as unknown as TransformStream<Chunk, Chunk>)
    .getReader()
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    out.push(value)
  }
  return out
}

const CITATIONS = { sourceCitations: { '1': { url: 'https://example.com', title: 'Example' } } }

test('metadata rides both start and finish, so sources linkify while streaming', async () => {
  const out = await run(
    [{ type: 'start' }, { type: 'text-delta', delta: 'hi' }, { type: 'finish' }],
    CITATIONS,
  )

  assert.deepEqual(out[0]!.messageMetadata, CITATIONS)
  assert.deepEqual(out[2]!.messageMetadata, CITATIONS)
  // Everything between is forwarded untouched.
  assert.deepEqual(out[1], { type: 'text-delta', delta: 'hi' })
  assert.equal(out.length, 3)
})

test('a turn with no citations is passed through unchanged', async () => {
  const chunks: Chunk[] = [{ type: 'start' }, { type: 'finish' }]
  assert.deepEqual(await run(chunks, undefined), chunks)
  assert.deepEqual(await run(chunks, {}), chunks)
})

test('metadata already set upstream wins over the fallback', async () => {
  const out = await run(
    [{ type: 'start', messageMetadata: { sourceCitations: { '9': { url: 'https://upstream' } } } }],
    CITATIONS,
  )

  assert.deepEqual(
    out[0]!.messageMetadata,
    { sourceCitations: { '9': { url: 'https://upstream' } } },
  )
})

test('non-lifecycle chunks never gain metadata', async () => {
  const out = await run(
    [{ type: 'tool-input-start', toolCallId: 'call_1' }, { type: 'start-step' }],
    CITATIONS,
  )

  assert.equal(out.every((chunk) => chunk.messageMetadata === undefined), true)
})
