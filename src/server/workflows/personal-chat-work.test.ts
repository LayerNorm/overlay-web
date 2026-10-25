import assert from 'node:assert/strict'
import test from 'node:test'
import {
  aggregatePersonalChatWorkUsage,
  buildPersonalChatWorkApprovalToken,
  workToolSuccessOutcome,
} from './personal-chat-work'

test('builds stable approval tokens for a run and cycle', () => {
  assert.equal(
    buildPersonalChatWorkApprovalToken('run_123', 2),
    'agent-run:run_123:approval:2',
  )
})

test('aggregates usage across durable WorkflowAgent steps', () => {
  const usage = aggregatePersonalChatWorkUsage([
    { usage: { inputTokens: 10, outputTokens: 3 } },
    { usage: { inputTokens: 7, outputTokens: 5 } },
  ] as never)
  assert.deepEqual(usage, { inputTokens: 17, outputTokens: 8 })
})

test('Work sends mapped screenshot content to the next model and only displays an image summary', () => {
  const result = {
    overlayModelOutput: {
      type: 'content',
      value: [
        { type: 'text', text: 'Screenshot captured at 1280 by 720 pixels.' },
        {
          type: 'file',
          data: { type: 'data', data: 'iVBORw==' },
          mediaType: 'image/png',
        },
      ],
    },
    display: {
      success: true,
      image: { omitted: 'image', bytes: 4 },
      width: 1280,
      height: 720,
    },
  }
  const outcome = workToolSuccessOutcome({
    toolCallId: 'screenshot-call',
    toolName: 'computer_screenshot',
    input: {},
  }, result)
  const nextModelMessage = {
    role: 'tool',
    content: [{
      type: 'tool-result',
      toolCallId: 'screenshot-call',
      toolName: 'computer_screenshot',
      output: outcome.output,
    }],
  }
  const streamPart = { type: 'tool-result', output: outcome.streamOutput }

  assert.deepEqual(nextModelMessage.content[0].output, result.overlayModelOutput)
  assert.deepEqual(result.overlayModelOutput.value, [
    { type: 'text', text: 'Screenshot captured at 1280 by 720 pixels.' },
    {
      type: 'file',
      data: { type: 'data', data: 'iVBORw==' },
      mediaType: 'image/png',
    },
  ])
  assert.deepEqual(streamPart.output, result.display)
  assert.deepEqual(outcome.transcript.output, result.display)
  assert.equal(
    (outcome.transcript.output as { image: unknown }).image instanceof Uint8Array,
    false,
  )
})

test('plain Work tool JSON results retain their existing model and display output', () => {
  const result = { success: true, message: 'done' }
  const outcome = workToolSuccessOutcome({
    toolCallId: 'json-call',
    toolName: 'plain_json',
    input: {},
  }, result)

  assert.deepEqual(outcome.output, { type: 'json', value: result })
  assert.equal(outcome.streamOutput, result)
  assert.equal(outcome.transcript.output, result)
})
