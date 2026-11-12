import assert from 'node:assert/strict'
import test from 'node:test'
import { chatStreamToNotebookEvents } from './notebook-chat-stream'

async function project(sse: string[]) {
  let ended = false
  const source = new ReadableStream<string>({
    start(controller) {
      for (const chunk of sse) controller.enqueue(chunk)
      controller.close()
    },
  })
  const text = await new Response(source.pipeThrough(chatStreamToNotebookEvents(() => { ended = true }))).text()
  return { ended, events: text.trim().split('\n').map((line) => JSON.parse(line) as Record<string, unknown>) }
}

const data = (value: unknown) => `data: ${JSON.stringify(value)}\n\n`

test('chat stream becomes whole text segments, tool rows and one done', async () => {
  const { ended, events } = await project([
    data({ type: 'start' }),
    data({ type: 'tool-input-available', toolName: 'get_note', toolCallId: 't1' }),
    data({ type: 'text-start', id: 'a' }),
    data({ type: 'text-delta', id: 'a', delta: 'Updated ' }),
    `data: ${JSON.stringify({ type: 'text-delta', id: 'a', delta: 'the intro.' })}`,
    `\n\n${data({ type: 'text-end', id: 'a' })}`,
    data({ type: 'finish' }),
    'data: [DONE]\n\n',
  ])
  assert.equal(ended, true)
  assert.deepEqual(events, [
    { type: 'tool_call', tool: 'get_note' },
    { type: 'text', text: 'Updated the intro.' },
    { type: 'done' },
  ])
})

test('errors are reported and an unfinished stream still ends', async () => {
  const { events } = await project([
    data({ type: 'text-delta', id: 'a', delta: 'Partial' }),
    data({ type: 'error', errorText: 'The durable run failed.' }),
  ])
  assert.deepEqual(events, [
    { type: 'text', text: 'Partial' },
    { type: 'error', error: 'The durable run failed.' },
    { type: 'done' },
  ])
})
