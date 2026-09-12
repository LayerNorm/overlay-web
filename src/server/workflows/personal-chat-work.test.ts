import assert from 'node:assert/strict'
import test from 'node:test'
import {
  aggregatePersonalChatWorkUsage,
  buildPersonalChatWorkApprovalToken,
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
