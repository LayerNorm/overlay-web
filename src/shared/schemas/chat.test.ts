import assert from 'node:assert/strict'
import test from 'node:test'
import { ActConversationRequest } from './chat'

test('validates the optional first-send scope', () => {
  for (const scope of ['personal', 'workspace', undefined] as const) {
    assert.equal(ActConversationRequest.parse({ conversationClientId: 'client-1', scope }).scope, scope)
  }
  assert.equal(ActConversationRequest.safeParse({ scope: 'account' }).success, false)
})

test('accepts legacy desktop and mobile slot fields without validating them', () => {
  const parsed = ActConversationRequest.parse({
    conversationId: 'conversation-1',
    messages: [],
    multiModelSlotIndex: 2,
    multiModelTotal: 4,
  })
  assert.equal(parsed.multiModelSlotIndex, 2)
  assert.equal(parsed.multiModelTotal, 4)
})

test('a person-set harness deadline keeps its 30-second minimum and has no upper bound', () => {
  const tenDays = 10 * 24 * 60 * 60 * 1_000
  assert.equal(ActConversationRequest.parse({ harnessBudget: { durationMs: tenDays } }).harnessBudget?.durationMs, tenDays)
  assert.equal(ActConversationRequest.safeParse({ harnessBudget: { durationMs: 29_999 } }).success, false)
  assert.equal(ActConversationRequest.safeParse({ harnessBudget: { durationMs: 60_000.5 } }).success, false)
})
