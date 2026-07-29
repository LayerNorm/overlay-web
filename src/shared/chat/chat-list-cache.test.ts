import assert from 'node:assert/strict'
import test from 'node:test'
import {
  clearAllChatListCaches,
  consumeNewEmptyChat,
  getCachedChatList,
  markNewEmptyChat,
  primeChatList,
  setActiveChatListWorkspace,
} from './chat-list-cache'

test('new empty chat markers are consumed exactly once', () => {
  clearAllChatListCaches()
  setActiveChatListWorkspace('workspace-a')
  const chat = { _id: 'chat_1', title: 'New Chat', lastModified: 1 }
  markNewEmptyChat(chat)
  assert.deepEqual(consumeNewEmptyChat('chat_1'), chat)
  assert.equal(consumeNewEmptyChat('chat_1'), null)
})

test('chat list cache is partitioned by active workspace', () => {
  clearAllChatListCaches()
  setActiveChatListWorkspace('workspace-a')
  primeChatList([{ _id: 'chat_a', title: 'Alpha', lastModified: 1 }])

  setActiveChatListWorkspace('workspace-b')
  assert.equal(getCachedChatList(), null)
  primeChatList([{ _id: 'chat_b', title: 'Beta', lastModified: 2 }])

  setActiveChatListWorkspace('workspace-a')
  assert.deepEqual(getCachedChatList()?.map((chat) => chat._id), ['chat_a'])
  setActiveChatListWorkspace('workspace-b')
  assert.deepEqual(getCachedChatList()?.map((chat) => chat._id), ['chat_b'])
})
