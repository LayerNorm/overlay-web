import assert from 'node:assert/strict'
import test from 'node:test'
import { agentConversationRedirect, resolveSoftChatRoute, selectConversationForView } from './chat-view-navigation'

test('one-to-one agent conversations move from Chats to their agent thread without losing history', () => {
  const args = { pathname: '/app/w/workspace-1/chat', workspaceId: 'workspace-1', agentId: 'overlay', conversationId: 'existing-thread', guided: false, showcase: false }
  assert.equal(agentConversationRedirect(args), '/app/w/workspace-1/agents?agent=overlay&id=existing-thread')
  assert.equal(agentConversationRedirect({ ...args, pathname: '/app/w/workspace-1/agents' }), null)
  assert.equal(agentConversationRedirect({ ...args, agentId: undefined }), null)
  assert.equal(agentConversationRedirect({ ...args, guided: true }), null)
  assert.equal(agentConversationRedirect({ ...args, showcase: true }), null)
})

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
