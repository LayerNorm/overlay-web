import 'server-only'

import test from 'node:test'
import assert from 'node:assert/strict'
import type { UIMessage } from 'ai'
import { FREE_TIER_DEFAULT_MODEL_ID } from '@/shared/ai/gateway/model-types'
import { compactMessagesForContext } from './context-compaction'

function textMessage(id: string, role: 'user' | 'assistant', text: string): UIMessage {
  return {
    id,
    role,
    parts: [{ type: 'text', text }],
  }
}

function longMessages(count: number, charsPerMessage = 900): UIMessage[] {
  return Array.from({ length: count }, (_, index) =>
    textMessage(
      `m${index + 1}`,
      index % 2 === 0 ? 'user' : 'assistant',
      `${index + 1}: ${'x'.repeat(charsPerMessage)}`,
    )
  )
}

test('context compaction leaves small transcripts unchanged', async () => {
  const messages = [
    textMessage('m1', 'user', 'hello'),
    textMessage('m2', 'assistant', 'hi'),
  ]
  const result = await compactMessagesForContext({
    messages,
    targetModelId: 'claude-sonnet-4-6',
    contextWindowOverride: 64_000,
    generateSummaryText: async () => {
      throw new Error('should not summarize')
    },
  })

  assert.equal(result.didCompact, false)
  assert.equal(result.usedFallbackTrim, false)
  assert.deepEqual(result.messages, messages)
})

test('context compaction summarizes old messages and preserves the newest two exactly', async () => {
  const messages = longMessages(10)
  const result = await compactMessagesForContext({
    messages,
    targetModelId: 'claude-sonnet-4-6',
    contextWindowOverride: 4_000,
    generateSummaryText: async ({ prompt }) => {
      assert.match(prompt, /Message 1/)
      assert.match(prompt, /id: m8/)
      assert.doesNotMatch(prompt, /id: m9/)
      assert.doesNotMatch(prompt, /id: m10/)
      return 'Structured summary of older context.'
    },
  })

  assert.equal(result.didCompact, true)
  assert.equal(result.usedFallbackTrim, false)
  assert.equal(result.messages.length, 3)
  assert.equal(result.messages[0]?.role, 'system')
  assert.equal(result.messages[1]?.id, 'm9')
  assert.equal(result.messages[2]?.id, 'm10')
  assert.equal(result.summaryToPersist?.summarizedThroughMessageId, 'm8')
})

test('context compaction uses the free summarizer for hosted target models', async () => {
  const result = await compactMessagesForContext({
    messages: longMessages(10),
    targetModelId: 'claude-sonnet-4-6',
    contextWindowOverride: 4_000,
    generateSummaryText: async () => 'Hosted model summary.',
  })

  assert.equal(result.summaryToPersist?.summarizerModelId, FREE_TIER_DEFAULT_MODEL_ID)
})

test('context compaction uses the selected BYOK model unless a summarizer is explicit', async () => {
  const targetModelId = 'byok/connection-1/model-a'
  const selected = await compactMessagesForContext({
    messages: longMessages(10),
    targetModelId,
    contextWindowOverride: 4_000,
    generateSummaryText: async () => 'BYOK model summary.',
  })
  const explicit = await compactMessagesForContext({
    messages: longMessages(10),
    targetModelId,
    summarizerModelId: 'openrouter/free',
    contextWindowOverride: 4_000,
    generateSummaryText: async () => 'Explicit summary.',
  })

  assert.equal(selected.summaryToPersist?.summarizerModelId, targetModelId)
  assert.equal(explicit.summaryToPersist?.summarizerModelId, 'openrouter/free')
})

test('context compaction rolls previous summary forward with only newly old messages', async () => {
  const messages = longMessages(10)
  let seenPrompt = ''
  const result = await compactMessagesForContext({
    messages,
    targetModelId: 'claude-sonnet-4-6',
    contextWindowOverride: 4_000,
    previousSummary: {
      summary: 'Previous durable summary.',
      summarizedThroughMessageId: 'm4',
    },
    generateSummaryText: async ({ prompt }) => {
      seenPrompt = prompt
      return 'Updated rolling summary.'
    },
  })

  assert.equal(result.didCompact, true)
  assert.match(seenPrompt, /Previous durable summary/)
  assert.doesNotMatch(seenPrompt, /id: m1/)
  assert.doesNotMatch(seenPrompt, /id: m4/)
  assert.match(seenPrompt, /id: m5/)
  assert.match(seenPrompt, /id: m8/)
  assert.equal(result.summaryToPersist?.summarizedThroughMessageId, 'm8')
})

test('context compaction falls back to deterministic trim when summarization fails', async () => {
  const messages = longMessages(12)
  const result = await compactMessagesForContext({
    messages,
    targetModelId: 'claude-sonnet-4-6',
    contextWindowOverride: 4_000,
    generateSummaryText: async () => {
      throw new Error('summarizer unavailable')
    },
  })

  assert.equal(result.didCompact, false)
  assert.equal(result.usedFallbackTrim, true)
  assert.equal(result.summaryToPersist, undefined)
  assert.ok(result.messages.length < messages.length)
  assert.equal(result.messages.at(-1)?.id, 'm12')
})
