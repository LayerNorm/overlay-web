import { describe, expect, test, vi } from 'vitest'
import type { NotebookAgentRequest } from '@overlay/app-core'
import {
  cancelNotebookRunAfterReconnectExhaustion,
  followNotebookAgentStream,
  NOTEBOOK_RECONNECT_EXHAUSTED_MESSAGE,
  notebookRunMayUpdate,
  notebookSnapshotMatches,
  resolveNotebookEditorEdit,
  stopNotebookRunAfterAcceptance,
} from './notebook-agent-reconnect'

const request: NotebookAgentRequest = {
  noteId: 'note-1',
  turnId: 'turn-1',
  noteContent: 'Frozen text',
  noteTitle: 'Notes',
  message: 'Make a proposal',
}

describe('Notebook editor coordinates', () => {
  const edit = { id: 'edit', description: 'Replace crates', startLine: 2, endLine: 2,
    originalLines: ['crates'], newLines: ['updated crates'] }

  test('maps canonical blocks over editor-only empty paragraphs without guessing duplicate text', () => {
    expect(resolveNotebookEditorEdit(edit, ['crates', 'crates', 'delivery'],
      ['crates', '', 'crates', '', 'delivery'])).toEqual({ ...edit, startLine: 3, endLine: 3 })
  })

  test('rejects changed content and ranges that cut through a multiline block', () => {
    expect(resolveNotebookEditorEdit(edit, ['meeting', 'crates'], ['meeting', '', 'changed'])).toBeNull()
    expect(resolveNotebookEditorEdit(edit, ['meeting', 'crates\nmore'], ['meeting', 'crates\nmore'])).toBeNull()
    expect(resolveNotebookEditorEdit({ ...edit, endLine: 3, originalLines: ['crates', 'more'] },
      ['meeting', 'crates\nmore'], ['meeting', '', 'crates\nmore'])).toMatchObject({ startLine: 3, endLine: 3 })
  })

  test('maps the empty note to its initial empty editor paragraph', () => {
    expect(resolveNotebookEditorEdit({ ...edit, startLine: 1, endLine: 1, originalLines: [''] }, [], ['']))
      .toMatchObject({ startLine: 1, endLine: 1 })
  })
})

describe('Notebook stream reconnect', () => {
  test('retries with the same turn and advances the admitted run cursor', async () => {
    const identity = { current: null as null | {
      runId: string
      conversationId: string
      turnId: string
      cursor?: string
    } }
    const calls: NotebookAgentRequest[] = []
    const result = await followNotebookAgentStream({
      request,
      signal: new AbortController().signal,
      getIdentity: () => identity.current,
      runAgent: async (next) => {
        calls.push(next)
        return new Response('')
      },
      readStream: async () => {
        if (calls.length === 1) {
          identity.current = { runId: 'run-1', conversationId: 'conversation-1', turnId: 'turn-1', cursor: '4.2' }
          return false
        }
        return true
      },
      wait: async () => undefined,
    })

    expect(result).toEqual({ status: 'complete' })
    expect(calls).toHaveLength(2)
    expect(calls[0]).toMatchObject({ noteId: 'note-1', turnId: 'turn-1' })
    expect(calls[1]).toMatchObject({ noteId: 'note-1', turnId: 'turn-1', runId: 'run-1', cursor: '4.2' })
  })

  test('caps reconnect attempts', async () => {
    let calls = 0
    const requests: NotebookAgentRequest[] = []
    const result = await followNotebookAgentStream({
      request,
      signal: new AbortController().signal,
      getIdentity: () => null,
      runAgent: async (next) => {
        calls += 1
        requests.push(next)
        return new Response('')
      },
      readStream: async () => false,
      wait: async () => undefined,
    })

    expect(result).toEqual({ status: 'exhausted' })
    expect(calls).toBe(4)
    expect(requests.map(next => next.turnId)).toEqual(['turn-1', 'turn-1', 'turn-1', 'turn-1'])
    expect(requests.every(next => next.runId === undefined)).toBe(true)
  })

  test('retains the admitted identity when cancellation after retry exhaustion fails', async () => {
    const run = { identity: { runId: 'run-1', conversationId: 'conversation-1', turnId: 'turn-1' } }
    const disconnect = vi.fn()
    const cancelled = await cancelNotebookRunAfterReconnectExhaustion({
      run,
      stopAgent: async () => { throw new Error('stop failed') },
      disconnect,
    })

    expect(cancelled).toBe(false)
    expect(run.identity).toEqual({ runId: 'run-1', conversationId: 'conversation-1', turnId: 'turn-1' })
    expect(disconnect).not.toHaveBeenCalled()
    expect(NOTEBOOK_RECONNECT_EXHAUSTED_MESSAGE)
      .toBe('The Notebook stream disconnected repeatedly. Stop this run before starting another request.')
  })

  test('cancels an accepted run before disconnecting its observer', async () => {
    const order: string[] = []
    await stopNotebookRunAfterAcceptance({
      identity: { runId: 'run-1', conversationId: 'conversation-1', turnId: 'turn-1' },
      requested: true,
      stopAgent: async ({ conversationId, turnId }) => {
        order.push(`stop:${conversationId}:${turnId}`)
      },
      disconnect: () => order.push('disconnect'),
    })
    expect(order).toEqual(['stop:conversation-1:turn-1', 'disconnect'])
  })

  test('keeps the observer connected when cancellation fails', async () => {
    const disconnect = vi.fn()
    await expect(stopNotebookRunAfterAcceptance({
      identity: { runId: 'run-1', conversationId: 'conversation-1', turnId: 'turn-1' },
      requested: true,
      stopAgent: async () => { throw new Error('stop failed') },
      disconnect,
    })).rejects.toThrow('stop failed')
    expect(disconnect).not.toHaveBeenCalled()
  })

  test('rejects proposals after the title or editor snapshot changes', () => {
    const frozen = {
      frozenTitle: 'Notes',
      frozenMarkdown: '# Original',
      currentTitle: 'Notes',
      currentMarkdown: '# Original',
    }
    expect(notebookSnapshotMatches(frozen)).toBe(true)
    expect(notebookSnapshotMatches({ ...frozen, currentMarkdown: '# Edited' })).toBe(false)
    expect(notebookSnapshotMatches({ ...frozen, currentTitle: 'Renamed' })).toBe(false)
  })

  test('a late callback cannot update a different note or a replacement run', () => {
    expect(notebookRunMayUpdate({
      currentNoteId: 'note-2',
      runNoteId: 'note-1',
      currentToken: 2,
      runToken: 1,
    })).toBe(false)
    expect(notebookRunMayUpdate({
      currentNoteId: 'note-1',
      runNoteId: 'note-1',
      currentToken: 2,
      runToken: 1,
    })).toBe(false)
    expect(notebookRunMayUpdate({
      currentNoteId: 'note-1',
      runNoteId: 'note-1',
      currentToken: 1,
      runToken: 1,
    })).toBe(true)
  })
})
