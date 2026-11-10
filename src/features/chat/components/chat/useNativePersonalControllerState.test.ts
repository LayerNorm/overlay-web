import assert from 'node:assert/strict'
import test from 'node:test'
import { PENDING_FIRST_CHAT_ID } from './chat-send-body-builders'
import { isNativePendingFirstTurn, nativeJournalInScope } from './useNativePersonalControllerState'

test('a first turn stays pending after its durable URL is published', () => {
  assert.equal(isNativePendingFirstTurn(PENDING_FIRST_CHAT_ID, null, null), true)
  assert.equal(isNativePendingFirstTurn(null, 'chat', 'chat'), true)
})

test('other chats are not treated as a pending first turn', () => {
  assert.equal(isNativePendingFirstTurn(null, null, null), false)
  assert.equal(isNativePendingFirstTurn(null, 'chat', null), false)
  assert.equal(isNativePendingFirstTurn(null, 'chat', 'other'), false)
  assert.equal(isNativePendingFirstTurn('chat', 'chat', 'chat'), false)
})

test('a new chat shows its first turn before the server creates the conversation', () => {
  // Enter pressed in a new chat: nothing selected, no conversation id yet.
  assert.equal(nativeJournalInScope(null, null, null, false), true)
  // Once created and selected, the selected conversation owns the journal.
  assert.equal(nativeJournalInScope('chat', null, 'chat', false), true)
  assert.equal(nativeJournalInScope('other', null, 'chat', false), false)
  assert.equal(nativeJournalInScope(null, 'chat', 'chat', true), true)
})
