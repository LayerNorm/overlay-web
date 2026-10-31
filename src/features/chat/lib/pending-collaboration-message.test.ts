import assert from 'node:assert/strict'
import test from 'node:test'
import {
  restorePendingCollaborationMessage,
  savePendingCollaborationMessage,
  takePendingCollaborationMessage,
} from './pending-collaboration-message'

test('pending instructions stay available until their conversation and agent are ready', () => {
  const previousWindow = globalThis.window
  const values = new Map<string, string>()
  const savedAt = 1_000
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      sessionStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
        removeItem: (key: string) => { values.delete(key) },
      },
    },
  })

  try {
    savePendingCollaborationMessage({
      conversationId: 'conversation-new',
      content: 'Run these instructions',
      expectedAgentPrincipalId: 'agent-principal',
    }, savedAt)
    const original = {
      conversationId: 'conversation-new',
      content: 'Run these instructions',
      expectedAgentPrincipalId: 'agent-principal',
      savedAt,
    }
    assert.equal(takePendingCollaborationMessage('conversation-old', undefined, savedAt), null)
    assert.equal(
      takePendingCollaborationMessage('conversation-new', (message) => (
        message.expectedAgentPrincipalId === 'another-agent'
      ), savedAt),
      null,
    )
    assert.deepEqual(
      takePendingCollaborationMessage('conversation-new', (message) => (
        message.expectedAgentPrincipalId === 'agent-principal'
      ), savedAt),
      original,
    )
    restorePendingCollaborationMessage(original)
    assert.deepEqual(JSON.parse(values.get('overlay:pending-collaboration-message')!), original)
    restorePendingCollaborationMessage({
      conversationId: 'conversation-other',
      content: 'Do not replace me',
      savedAt,
    })
    assert.deepEqual(JSON.parse(values.get('overlay:pending-collaboration-message')!), original)
    assert.deepEqual(
      takePendingCollaborationMessage('conversation-new', undefined, savedAt),
      original,
    )
    assert.equal(takePendingCollaborationMessage('conversation-new', undefined, savedAt), null)

    savePendingCollaborationMessage({
      conversationId: 'conversation-new',
      content: 'Expired instructions',
    }, savedAt)
    assert.equal(takePendingCollaborationMessage('conversation-other', undefined, savedAt + 60_001), null)
    assert.equal(values.has('overlay:pending-collaboration-message'), false)

    values.set('overlay:pending-collaboration-message', JSON.stringify({
      conversationId: 'conversation-new',
      content: 'Malformed instructions',
      savedAt: 'not-a-timestamp',
    }))
    assert.equal(takePendingCollaborationMessage('conversation-new', undefined, savedAt), null)
    assert.equal(values.has('overlay:pending-collaboration-message'), false)
  } finally {
    Object.defineProperty(globalThis, 'window', { configurable: true, value: previousWindow })
  }
})
