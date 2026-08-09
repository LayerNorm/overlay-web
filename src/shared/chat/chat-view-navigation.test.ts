import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveSoftChatRoute, selectConversationForView } from './chat-view-navigation'

const chats = [
  { _id: 'newest', title: 'Newest', lastModified: 20, conversationType: 'channel' as const },
  { _id: 'stored', title: 'Stored', lastModified: 10, conversationType: 'channel' as const },
]

test('restores a stored conversation that exists in the selected view', () => {
  assert.equal(selectConversationForView(chats, 'stored')?._id, 'stored')
})

test('falls back to the latest conversation when the stored id belongs to another view', () => {
  assert.equal(selectConversationForView(chats, 'stale-dm')?._id, 'newest')
})

test('returns null for an empty view', () => {
  assert.equal(selectConversationForView([], 'stale'), null)
})

test('a browser route with no id does not inherit the previous Next route id', () => {
  assert.deepEqual(resolveSoftChatRoute(
    { conversationId: null, view: 'channels' },
    { conversationId: 'old-personal-chat', view: 'personal' },
  ), { conversationId: null, view: 'channels' })
})

test('server rendering falls back to the Next route', () => {
  assert.deepEqual(resolveSoftChatRoute(
    null,
    { conversationId: 'dm-1', view: 'dms' },
  ), { conversationId: 'dm-1', view: 'dms' })
})
