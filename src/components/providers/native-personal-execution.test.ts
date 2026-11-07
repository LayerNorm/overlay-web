import assert from 'node:assert/strict'
import test from 'node:test'
import { nativePersonalExecutionArgs, scopedNativePersonalExecution } from './native-personal-execution'

const scope = {
  enabled: true,
  canQuery: true,
  workspaceId: 'workspace',
  viewerUserId: 'viewer',
  conversationId: 'conversation',
  summaryConversationId: 'conversation',
  transcriptConversationId: 'conversation',
  transcriptStatus: 'ready' as const,
}

const value = {
  ...scope,
  userId: 'viewer',
  compatibility: { readOnly: false as const },
  run: null,
}

test('execution subscription args require the exact personal route and resolved summary scope', () => {
  assert.deepEqual(nativePersonalExecutionArgs(scope), {
    workspaceId: 'workspace', conversationId: 'conversation',
  })
  assert.equal(nativePersonalExecutionArgs({ ...scope, enabled: false }), 'skip')
  assert.equal(nativePersonalExecutionArgs({ ...scope, summaryConversationId: null }), 'skip')
  assert.equal(nativePersonalExecutionArgs({ ...scope, transcriptConversationId: 'other' }), 'skip')
})

test('a chat whose summary is still loading reads as loading, not disabled', () => {
  const withoutConversation = { ...scope, conversationId: null, value: undefined }
  assert.deepEqual(scopedNativePersonalExecution({ ...withoutConversation, transcriptStatus: 'loading' }), {
    status: 'loading', value: null,
  })
  assert.deepEqual(scopedNativePersonalExecution({ ...withoutConversation, transcriptStatus: 'ready' }), {
    status: 'disabled', value: null,
  })
  assert.deepEqual(scopedNativePersonalExecution({ ...withoutConversation, transcriptStatus: 'unavailable' }), {
    status: 'unavailable', value: null,
  })
})

test('execution results are exposed only for the verified viewer, workspace and conversation', () => {
  assert.deepEqual(scopedNativePersonalExecution({ ...scope, value }), { status: 'ready', value })
  assert.deepEqual(scopedNativePersonalExecution({ ...scope, viewerUserId: 'other', value }), {
    status: 'unavailable', value: null,
  })
  assert.deepEqual(scopedNativePersonalExecution({ ...scope, conversationId: 'other', value }), {
    status: 'loading', value: null,
  })
  assert.deepEqual(scopedNativePersonalExecution({ ...scope, transcriptStatus: 'unavailable', value: undefined }), {
    status: 'unavailable', value: null,
  })
})
