import 'server-only'

import assert from 'node:assert/strict'
import test from 'node:test'

import {
  accumulateAnthropicEvent,
  accumulateOpenAiEvent,
  consumeSseUsage,
  usageFromAnthropicJson,
  usageFromOpenAiJson,
  type ParsedTokenUsage,
} from './proxy'

test('anthropic JSON usage maps cache fields into input vs cached buckets', () => {
  const usage = usageFromAnthropicJson({
    usage: {
      input_tokens: 1200,
      cache_read_input_tokens: 800,
      cache_creation_input_tokens: 300,
      output_tokens: 90,
    },
  })
  assert.deepEqual(usage, { inputTokens: 1500, cachedInputTokens: 800, outputTokens: 90 })
  assert.equal(usageFromAnthropicJson({ usage: {} }), null)
  assert.equal(usageFromAnthropicJson({}), null)
})

test('openai JSON usage handles chat.completions and responses shapes', () => {
  assert.deepEqual(usageFromOpenAiJson({
    usage: {
      prompt_tokens: 500,
      completion_tokens: 40,
      prompt_tokens_details: { cached_tokens: 100 },
    },
  }), { inputTokens: 500, cachedInputTokens: 100, outputTokens: 40 })
  assert.deepEqual(usageFromOpenAiJson({
    usage: {
      input_tokens: 700,
      output_tokens: 60,
      input_tokens_details: { cached_tokens: 200 },
    },
  }), { inputTokens: 700, cachedInputTokens: 200, outputTokens: 60 })
  assert.equal(usageFromOpenAiJson({ usage: {} }), null)
})

test('anthropic SSE accumulation keeps cumulative output_tokens from the last delta', () => {
  const acc: ParsedTokenUsage = { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0 }
  accumulateAnthropicEvent(acc, {
    type: 'message_start',
    message: { usage: { input_tokens: 1000, cache_read_input_tokens: 50, cache_creation_input_tokens: 20 } },
  })
  accumulateAnthropicEvent(acc, { type: 'message_delta', usage: { output_tokens: 10 } })
  accumulateAnthropicEvent(acc, { type: 'message_delta', usage: { output_tokens: 25 } })
  assert.deepEqual(acc, { inputTokens: 1020, cachedInputTokens: 50, outputTokens: 25 })
})

test('openai SSE accumulation reads usage chunks and terminal response events', () => {
  const acc: ParsedTokenUsage = { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0 }
  accumulateOpenAiEvent(acc, {
    usage: { prompt_tokens: 300, completion_tokens: 12, prompt_tokens_details: { cached_tokens: 30 } },
  })
  assert.deepEqual(acc, { inputTokens: 300, cachedInputTokens: 30, outputTokens: 12 })
  const acc2: ParsedTokenUsage = { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0 }
  accumulateOpenAiEvent(acc2, {
    type: 'response.completed',
    response: { usage: { input_tokens: 900, output_tokens: 45, input_tokens_details: { cached_tokens: 80 } } },
  })
  assert.deepEqual(acc2, { inputTokens: 900, cachedInputTokens: 80, outputTokens: 45 })
})

test('consumeSseUsage taps a stream without consuming the client branch', async () => {
  const sse = [
    'event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":100,"output_tokens":1}}}\n\n',
    'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"text":"hi"}}\n\n',
    'event: message_delta\ndata: {"type":"message_delta","usage":{"output_tokens":7}}\n\n',
  ].join('')
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(sse))
      controller.close()
    },
  })
  const usage = await consumeSseUsage(stream, 'anthropic')
  assert.deepEqual(usage, { inputTokens: 100, cachedInputTokens: 0, outputTokens: 7 })
})

test('consumeSseUsage returns null for streams without usage events', async () => {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('data: {"type":"ping"}\n\ndata: [DONE]\n\n'))
      controller.close()
    },
  })
  assert.equal(await consumeSseUsage(stream, 'anthropic'), null)
})
