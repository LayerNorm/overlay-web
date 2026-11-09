import { describe, expect, test } from 'vitest'
import { matchesNotebookRunIdentity, notebookRequestDigest } from './notebook-agent-identity'

const requestDigest = notebookRequestDigest({
  noteId: 'note-1',
  turnId: 'turn-1',
  noteMarkdown: 'Frozen note',
  noteTitle: 'Notes',
  message: 'Make a proposal',
  modelId: 'test-model',
})
const state = {
  runId: 'harness-run-1',
  source: { conversationId: 'conversation-1' },
  policy: {
    actorUserId: 'user-1',
    workspaceId: 'workspace-1',
    surface: { kind: 'notebook' as const, noteId: 'note-1', turnId: 'turn-1', requestDigest },
    allowedToolIds: ['read_note', 'propose_edit', 'finish'],
  },
} as Parameters<typeof matchesNotebookRunIdentity>[0]['state']

const request = {
  state,
  userId: 'user-1',
  workspaceId: 'workspace-1',
  noteId: 'note-1',
  turnId: 'turn-1',
  conversationId: 'conversation-1',
  requestDigest,
  runId: 'harness-run-1',
}

describe('Notebook reconnect identity', () => {
  test('accepts the same owned Notebook run for replay', () => {
    expect(matchesNotebookRunIdentity(request)).toBe(true)
    expect(matchesNotebookRunIdentity({ ...request, runId: undefined })).toBe(true)
  })

  test.each([
    ['run', { runId: 'other-run' }],
    ['user', { userId: 'other-user' }],
    ['workspace', { workspaceId: 'other-workspace' }],
    ['note', { noteId: 'other-note' }],
    ['turn', { turnId: 'other-turn' }],
    ['conversation', { conversationId: 'other-conversation' }],
    ['request', { requestDigest: 'f'.repeat(64) }],
  ])('rejects a reconnect with a different %s', (_label, override) => {
    expect(matchesNotebookRunIdentity({ ...request, ...override })).toBe(false)
  })

  test('rejects a durable run whose tool policy is outside the Notebook set', () => {
    const mismatchedState = {
      ...state,
      policy: { ...state.policy, allowedToolIds: ['computer_browser'] },
    } as typeof state
    expect(matchesNotebookRunIdentity({ ...request, state: mismatchedState })).toBe(false)
    const incompleteState = {
      ...state,
      policy: { ...state.policy, allowedToolIds: [] },
    } as typeof state
    expect(matchesNotebookRunIdentity({ ...request, state: incompleteState })).toBe(false)
  })
})
