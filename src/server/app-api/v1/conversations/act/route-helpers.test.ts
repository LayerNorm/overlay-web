import assert from 'node:assert/strict'
import test from 'node:test'
import type { UIMessage } from '@/server/ai/sdk'
import {
  AUTOMATION_ACT_ABORT_TIMEOUT_MS,
  DEFAULT_ACT_ABORT_TIMEOUT_MS,
  MAX_ACT_ABORT_TIMEOUT_MS,
  MIN_ACT_ABORT_TIMEOUT_MS,
  messagesRequireVision,
  prefixFallbackNoticeAfterStart,
  resolveActAbortTimeoutMs,
  resolveActMultiModelState,
  resolveActTurnId,
  runActModelAttempts,
} from './route-helpers'

test('resolveActAbortTimeoutMs preserves timeout defaults and clamps', () => {
  assert.equal(resolveActAbortTimeoutMs({}), DEFAULT_ACT_ABORT_TIMEOUT_MS)
  assert.equal(resolveActAbortTimeoutMs({ automationExecution: true }), AUTOMATION_ACT_ABORT_TIMEOUT_MS)
  assert.equal(resolveActAbortTimeoutMs({ requestedTimeoutMs: 1 }), MIN_ACT_ABORT_TIMEOUT_MS)
  assert.equal(resolveActAbortTimeoutMs({ requestedTimeoutMs: 999_999 }), MAX_ACT_ABORT_TIMEOUT_MS)
  assert.equal(resolveActAbortTimeoutMs({ requestedTimeoutMs: 45_500.9 }), 45_500)
})

test('resolveActMultiModelState clamps slots and marks follow-up slots', () => {
  assert.deepEqual(resolveActMultiModelState({ rawMultiModelTotal: 8, rawMultiModelSlotIndex: 9 }), {
    multiModelTotal: 4,
    multiModelSlotIndex: 3,
    isMultiModelFollowUpSlot: true,
  })
  assert.deepEqual(resolveActMultiModelState({ rawMultiModelTotal: 1, rawMultiModelSlotIndex: 1 }), {
    multiModelTotal: 1,
    multiModelSlotIndex: 1,
    isMultiModelFollowUpSlot: false,
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

test('runActModelAttempts preserves fallback and reservation response behavior', async () => {
  const events: string[] = []
  const result = await runActModelAttempts<string>({
    attemptModelIds: ['model_a', 'model_b'],
    reserveBudgetForAttempt: async () => ({ ok: true }),
    onFallback: (from, to) => events.push(`fallback:${from}->${to}`),
    onAttemptFailure: async (error, modelId, hasFallback) => {
      events.push(`failed:${modelId}:${hasFallback}:${error instanceof Error ? error.message : String(error)}`)
    },
    runAttempt: async ({ attemptModelId, fallbackNotice }) => {
      events.push(`run:${attemptModelId}:${fallbackNotice ?? 'none'}`)
      if (attemptModelId === 'model_a') throw new Error('upstream failed')
      return 'ok'
    },
  })

  assert.equal(result, 'ok')
  assert.deepEqual(events, [
    'run:model_a:none',
    'failed:model_a:true:upstream failed',
    'fallback:model_a->model_b',
    'run:model_b:model_a unavailable, switching to model_b.',
  ])

  const reservation = await runActModelAttempts<string>({
    attemptModelIds: ['model_a'],
    reserveBudgetForAttempt: async () => ({
      ok: false,
      reason: 'budget',
      response: 'budget-response',
    }),
    onFallback: () => {},
    onAttemptFailure: () => {},
    runAttempt: async () => {
      throw new Error('should not run')
    },
  })
  assert.equal(reservation, 'budget-response')
})

test('runActModelAttempts describes the full budget fallback chain', async () => {
  const events: string[] = []
  const result = await runActModelAttempts<string>({
    attemptModelIds: [
      'openrouter/nvidia/nemotron-3-super-120b-a12b:free',
      'openrouter/free',
      'stepfun-ai/step-3.5-flash',
    ],
    reserveBudgetForAttempt: async (attemptModelId) => {
      if (attemptModelId === 'stepfun-ai/step-3.5-flash') return { ok: true }
      return {
        ok: false,
        reason: 'budget',
        response: `budget:${attemptModelId}`,
      }
    },
    onFallback: (from, to, failedAttempts) => {
      events.push(`fallback:${from}->${to}:${failedAttempts.map((attempt) => attempt.modelId).join(',')}`)
    },
    onAttemptFailure: () => {},
    runAttempt: async ({ attemptModelId, fallbackNotice }) => {
      events.push(`run:${attemptModelId}:${fallbackNotice ?? 'none'}`)
      return 'ok'
    },
  })

  assert.equal(result, 'ok')
  assert.deepEqual(events, [
    'fallback:openrouter/free->stepfun-ai/step-3.5-flash:openrouter/nvidia/nemotron-3-super-120b-a12b:free,openrouter/free',
    'run:stepfun-ai/step-3.5-flash:Free: Nemotron 3 Super 120B and Free Router exceeded remaining budget, switching to Free: Step 3.5 Flash.',
  ])
})

test('prefixFallbackNoticeAfterStart inserts fallback frames after the first stream frame', async () => {
  const encoder = new TextEncoder()
  const decoder = new TextDecoder()
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode('data: {"type":"start"}\n\n'))
      controller.enqueue(encoder.encode('data: {"type":"text-delta","delta":"hello"}\n\n'))
      controller.close()
    },
  })

  const transformed = prefixFallbackNoticeAfterStart(stream, 'Model A unavailable.')
  assert.ok(transformed)
  const reader = transformed.getReader()
  let body = ''
  while (true) {
    const next = await reader.read()
    if (next.done) break
    body += decoder.decode(next.value)
  }

  assert.match(body, /^data: \{"type":"start"\}\n\ndata: \{"type":"text-start","id":"fallback-/)
  assert.equal(body.includes('Model A unavailable.\\n\\n'), true)
  assert.equal(body.endsWith('data: {"type":"text-delta","delta":"hello"}\n\n'), true)
})
