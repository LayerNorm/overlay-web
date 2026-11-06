import assert from 'node:assert/strict'
import test from 'node:test'
import {
  canSetPendingTranscript,
  pendingIntentMatches,
  pendingTranscriptInvalid,
  selectedChatIdFromRouteEvent,
} from './usePersonalChatTranscript'

test('route-selected identity wins over stale search parameters and explicit new-chat events clear it', () => {
  assert.equal(selectedChatIdFromRouteEvent({ chatId: 'selected-chat' }, '?id=stale-chat', true), 'selected-chat')
  assert.equal(selectedChatIdFromRouteEvent({ chatId: null }, '?id=stale-chat', true), null)
  assert.equal(selectedChatIdFromRouteEvent(undefined, '?id=route-chat', true), 'route-chat')
  assert.equal(selectedChatIdFromRouteEvent({ chatId: 'selected-chat' }, '?id=stale-chat', false), null)
})

test('pending transcript activation is fenced by route generation, identity, workspace and route selection', () => {
  const scope = {
    currentRouteGeneration: 4,
    renderRouteGeneration: 4,
    currentRouteKey: 'route',
    renderRouteKey: 'route',
    currentWorkspaceId: 'workspace',
    renderWorkspaceId: 'workspace',
    canQuery: true,
    canRead: true,
    viewerUserId: 'viewer',
    ownerId: 'viewer',
    selectedConversationId: null,
  }
  assert.equal(canSetPendingTranscript(scope), true)
  assert.equal(canSetPendingTranscript({ ...scope, currentRouteGeneration: 5 }), false)
  assert.equal(canSetPendingTranscript({ ...scope, currentWorkspaceId: 'other' }), false)
  assert.equal(canSetPendingTranscript({ ...scope, viewerUserId: 'other' }), false)
  assert.equal(canSetPendingTranscript({ ...scope, selectedConversationId: 'new-route-chat' }), false)
  assert.equal(pendingTranscriptInvalid({
    conversationId: 'old-chat', ownerId: 'viewer', workspaceId: 'workspace',
  }, 'workspace', null, true, { userId: 'viewer' }), false)
  assert.equal(pendingTranscriptInvalid({
    conversationId: 'old-chat', ownerId: 'viewer', workspaceId: 'workspace',
  }, 'workspace', 'new-route-chat', true, { userId: 'viewer' }), true)
})

test('a stale pending setter cannot clear a newer activation intent', () => {
  const current = {
    conversationId: 'new-chat',
    ownerId: 'viewer',
    workspaceId: 'workspace',
    intentKey: 'new-turn',
  }
  assert.equal(pendingIntentMatches(current, 'old-turn', 'viewer', 'workspace'), false)
  assert.equal(pendingIntentMatches(current, 'new-turn', 'viewer', 'workspace'), true)
  assert.equal(pendingIntentMatches(current, 'new-turn', 'viewer', 'other'), false)
})
