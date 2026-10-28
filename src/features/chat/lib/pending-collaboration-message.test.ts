import assert from 'node:assert/strict'
import test from 'node:test'
import {
  savePendingCollaborationMessage,
  takePendingCollaborationMessage,
} from './pending-collaboration-message'

test('pending instructions stay available until their conversation and agent are ready', () => {
  const previousWindow = globalThis.window
  const values = new Map<string, string>()
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
    })

    assert.equal(takePendingCollaborationMessage('conversation-old'), null)
    assert.equal(
      takePendingCollaborationMessage('conversation-new', (message) => (
        message.expectedAgentPrincipalId === 'another-agent'
      )),
      null,
    )
    assert.deepEqual(
      takePendingCollaborationMessage('conversation-new', (message) => (
        message.expectedAgentPrincipalId === 'agent-principal'
      )),
      {
        conversationId: 'conversation-new',
        content: 'Run these instructions',
        expectedAgentPrincipalId: 'agent-principal',
      },
    )
    assert.equal(takePendingCollaborationMessage('conversation-new'), null)
  } finally {
    Object.defineProperty(globalThis, 'window', { configurable: true, value: previousWindow })
  }
})
