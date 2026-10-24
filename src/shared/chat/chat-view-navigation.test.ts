import assert from 'node:assert/strict'
import test from 'node:test'
import {
  agentConversationRedirect,
  isTransientConversationDraft,
  resolveSoftChatRoute,
  scopeForConversationDetail,
  selectConversationForView,
  shouldSkipChatHistoryPrefetch,
} from './chat-view-navigation'
import { buildWorkspaceHandleHref } from '../workspaces/routing'

test('empty channels are durable even when opened through a legacy draft link', () => {
  assert.equal(isTransientConversationDraft('channel', true), false)
  assert.equal(isTransientConversationDraft('channel', false), false)
  assert.equal(isTransientConversationDraft('dm', true), true)
  assert.equal(isTransientConversationDraft('dm', false), false)
})

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

test('authorized chat detail metadata determines its existing scope bucket', () => {
  assert.equal(scopeForConversationDetail({ conversationType: 'dm' }), 'workspace')
  assert.equal(scopeForConversationDetail({ conversationType: 'channel' }), 'workspace')
  assert.equal(scopeForConversationDetail({ conversationType: 'personal' }), 'personal')
  assert.equal(scopeForConversationDetail({ scope: 'workspace' }), 'workspace')
  assert.equal(scopeForConversationDetail({}), 'personal')
})

test('an authorized detail in the wrong scope redirects to its actual scoped route', () => {
  const actualScope = scopeForConversationDetail({ conversationType: 'dm' })
  assert.equal(actualScope, 'workspace')
  assert.equal(
    buildWorkspaceHandleHref('team-a', '/w/team-a/personal/chat?id=dm-1', actualScope),
    '/w/team-a/workspace/chat?id=dm-1&view=workspace-chats',
  )
})

test('scoped chat routes and legacy view selectors skip untagged server prefetch', () => {
  assert.equal(shouldSkipChatHistoryPrefetch({
    pathScope: 'personal',
    hasScopeQuery: false,
    hasViewQuery: false,
  }), true)
  assert.equal(shouldSkipChatHistoryPrefetch({
    pathScope: null,
    hasScopeQuery: false,
    hasViewQuery: true,
  }), true)
  assert.equal(shouldSkipChatHistoryPrefetch({
    pathScope: null,
    hasScopeQuery: false,
    hasViewQuery: false,
  }), false)
})
