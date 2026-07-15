import assert from 'node:assert/strict'
import test from 'node:test'
import { shouldReloadActiveConversation } from './postgres-conversation-event-policy'

test('local stream lifecycle events do not replace the visible message during reconciliation grace', () => {
  assert.equal(shouldReloadActiveConversation({
    eventTypes: ['message.delta', 'message.completed'],
    localStreamGraceUntil: 10_000,
    now: 9_000,
  }), false)
})

test('remote lifecycle and destructive message events still reload durable state', () => {
  assert.equal(shouldReloadActiveConversation({
    eventTypes: ['message.completed'],
    localStreamGraceUntil: 0,
    now: 9_000,
  }), true)
  assert.equal(shouldReloadActiveConversation({
    eventTypes: ['message.deleted'],
    localStreamGraceUntil: 10_000,
    now: 9_000,
  }), true)
})

test('conversation metadata events refresh the list without replacing active messages', () => {
  assert.equal(shouldReloadActiveConversation({
    eventTypes: ['conversation.updated'],
    localStreamGraceUntil: 0,
    now: 9_000,
  }), false)
})
