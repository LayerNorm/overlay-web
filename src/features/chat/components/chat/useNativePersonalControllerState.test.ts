import assert from 'node:assert/strict'
import test from 'node:test'
import { PENDING_FIRST_CHAT_ID } from './chat-send-body-builders'
import { isNativePendingFirstTurn } from './useNativePersonalControllerState'

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
