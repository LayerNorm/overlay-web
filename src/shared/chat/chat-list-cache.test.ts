import assert from 'node:assert/strict'
import test from 'node:test'
import { clearChatListCache, consumeNewEmptyChat, markNewEmptyChat } from './chat-list-cache'

test('new empty chat markers are consumed exactly once', () => {
  clearChatListCache()
  const chat = { _id: 'chat_1', title: 'New Chat', lastModified: 1 }
  markNewEmptyChat(chat)
  assert.deepEqual(consumeNewEmptyChat('chat_1'), chat)
  assert.equal(consumeNewEmptyChat('chat_1'), null)
})
