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
