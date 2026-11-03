import assert from 'node:assert/strict'
import test from 'node:test'
import type { UIMessage } from '@/server/ai/sdk'
import {
  AUTOMATION_ACT_ABORT_TIMEOUT_MS,
  DEFAULT_ACT_ABORT_TIMEOUT_MS,
  MAX_ACT_ABORT_TIMEOUT_MS,
  MAX_ACT_OUTPUT_TOKENS_PER_STEP,
  MIN_ACT_ABORT_TIMEOUT_MS,
  drainReadableStream,
  estimateToolLoopReservationTokens,
  messagesRequireVision,
  resolveActAbortTimeoutMs,
  resolveActTurnId,
  observeFirstTextToken,
} from './route-helpers'

test('first-token observation ignores stream scaffolding and fires once', async () => {
  let observations = 0
  const encoder = new TextEncoder()
  const chunks = [
    'data: {"type":"start"}\n\ndata: {"type":"text-start"}\n\n',
    'data: {"type":"text-delta","delta":"hello"}\n\n',
    'data: {"type":"text-delta","delta":" world"}\n\n',
  ]
  const source = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
      controller.close()
    },
  })
  await drainReadableStream(observeFirstTextToken(source, () => { observations += 1 }))
  assert.equal(observations, 1)
})

test('resolveActAbortTimeoutMs preserves timeout defaults and clamps', () => {
  assert.equal(resolveActAbortTimeoutMs({}), DEFAULT_ACT_ABORT_TIMEOUT_MS)
  assert.equal(resolveActAbortTimeoutMs({ automationExecution: true }), AUTOMATION_ACT_ABORT_TIMEOUT_MS)
  assert.equal(resolveActAbortTimeoutMs({ requestedTimeoutMs: 1 }), MIN_ACT_ABORT_TIMEOUT_MS)
  assert.equal(resolveActAbortTimeoutMs({ requestedTimeoutMs: 999_999 }), MAX_ACT_ABORT_TIMEOUT_MS)
  assert.equal(resolveActAbortTimeoutMs({ requestedTimeoutMs: 45_500.9 }), 45_500)
})

test('tool-loop reservations cover every permitted model step', () => {
  assert.deepEqual(estimateToolLoopReservationTokens({
    estimatedInputTokens: 10_001,
    maxOutputTokensPerStep: MAX_ACT_OUTPUT_TOKENS_PER_STEP,
    maxSteps: 12,
  }), {
    estimatedInputTokens: 120_012,
    maxOutputTokens: 98_304,
  })
})

test('resolveActTurnId and messagesRequireVision preserve request preparation behavior', () => {
  assert.equal(resolveActTurnId(' turn_1 ', 123), 'turn_1')
  assert.equal(resolveActTurnId('', 123), 'act-123')

  const messages: UIMessage[] = [{
    id: 'm1',
    role: 'user',
    parts: [{ type: 'file', mediaType: 'image/png', url: 'https://example.com/a.png' }],
  }]
  assert.equal(messagesRequireVision(messages), true)
  assert.equal(messagesRequireVision([{ id: 'm2', role: 'user', parts: [{ type: 'text', text: 'hello' }] }]), false)
})
