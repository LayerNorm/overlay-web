import assert from 'node:assert/strict'
import test from 'node:test'
import { reconcileTranscriptIdentity } from './chat-transcript-identity'

test('saving the first streamed turn preserves the transcript mount', () => {
  const blank = { conversationId: null, firstTurnId: null, key: 0 }
  const streaming = reconcileTranscriptIdentity(blank, null, 'turn-1')
  const saved = reconcileTranscriptIdentity(streaming, 'saved-chat', 'turn-1')
  assert.equal(saved.key, streaming.key)
  assert.equal(reconcileTranscriptIdentity(saved, 'saved-chat', 'turn-1'), saved)
  assert.equal(reconcileTranscriptIdentity(saved, 'saved-chat', 'turn-2').key, saved.key)
})

test('navigation resets the scroller even when a branch shares the first turn', () => {
  const current = { conversationId: 'chat-1', firstTurnId: 'turn-1', key: 0 }
  const branch = reconcileTranscriptIdentity(current, 'chat-2', 'turn-1')
  assert.equal(branch.key, 1)
  const blank = reconcileTranscriptIdentity(branch, null, null)
  assert.equal(blank.key, 2)
  const streaming = reconcileTranscriptIdentity(blank, null, 'new-turn')
  const otherChat = reconcileTranscriptIdentity(streaming, 'chat-3', 'other-turn')
  assert.equal(otherChat.key, 3)
})
