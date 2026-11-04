import assert from 'node:assert/strict'
import test from 'node:test'
import { readPublicTrace } from './public-trace'

function stream(records: unknown[]) {
  const bytes = new TextEncoder().encode(records.map(record => JSON.stringify(record)).join('\n') + '\n')
  return new Response(new ReadableStream({ start(controller) {
    for (let index = 0; index < bytes.length; index += 37) controller.enqueue(bytes.slice(index, index + 37))
    controller.close()
  } }))
}

test('loads more than eighty parts across fragmented UTF-8 chunks without repeating the final answer', async () => {
  const parts = Array.from({ length: 96 }, (_, index) => ({ type: 'text', text: `Update ${index} 界` }))
  const result = await readPublicTrace(stream([
    { type: 'step', sequence: 1, persistence: { content: '', parts } },
    { type: 'done', legacy: true, resultSummary: 'Update 95 界' },
  ]))
  assert.deepEqual(result, { parts, legacy: true })
  const withSummary = await readPublicTrace(stream([
    { type: 'step', sequence: 1, persistence: { content: '', parts } },
    { type: 'done', legacy: false, resultSummary: 'Final answer.' },
  ]))
  assert.equal(withSummary?.parts.length, 97)
  assert.deepEqual(withSummary?.parts.at(-1), { type: 'text', text: 'Final answer.' })
})

test('does not replace the existing response with an interrupted or invalid trace', async () => {
  const step = { type: 'step', sequence: 1, persistence: { content: 'partial', parts: [] } }
  await assert.rejects(readPublicTrace(stream([step])))
  await assert.rejects(readPublicTrace(stream([step, step, { type: 'done' }])))
  await assert.rejects(readPublicTrace(stream([{ type: 'error' }])))
  assert.equal(await readPublicTrace(new Response(null, { status: 404 })), null)
})
