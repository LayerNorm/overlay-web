import assert from 'node:assert/strict'
import test from 'node:test'
import {
  conversationActivityLabel,
  resolveConversationActivityState,
} from './conversation-activity-state'

test('activity state prefers a missing or deleted conversation over archive', () => {
  assert.equal(resolveConversationActivityState({ conversation: null }), 'deleted')
  assert.equal(resolveConversationActivityState({
    archivedAt: 1,
    conversation: { deletedAt: 2 },
  }), 'deleted')
})

test('activity state marks an intact archived conversation', () => {
  assert.equal(resolveConversationActivityState({
    archivedAt: 1,
    conversation: {},
  }), 'archived')
  assert.equal(resolveConversationActivityState({ conversation: {} }), undefined)
})

test('activity labels are explicit about archived vs deleted chats', () => {
  assert.equal(conversationActivityLabel('archived'), 'Archived chat')
  assert.equal(conversationActivityLabel('deleted'), 'Deleted chat')
  assert.equal(conversationActivityLabel(undefined), undefined)
})
