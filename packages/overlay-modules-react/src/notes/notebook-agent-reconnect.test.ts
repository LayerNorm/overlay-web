import { describe, expect, test, vi } from 'vitest'
import type { NotebookAgentRequest } from '@overlay/app-core'
import {
  followNotebookAgentStream,
  notebookSnapshotMatches,
  stopNotebookRunAfterAcceptance,
} from './notebook-agent-reconnect'

const request: NotebookAgentRequest = {
  noteId: 'note-1',
  turnId: 'turn-1',
  noteContent: 'Frozen text',
  noteTitle: 'Notes',
  message: 'Make a proposal',
}

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
    const result = await followNotebookAgentStream({
      request,
      signal: new AbortController().signal,
      getIdentity: () => null,
      runAgent: async () => {
        calls += 1
        return new Response('')
      },
      readStream: async () => false,
      wait: async () => undefined,
    })

    expect(result).toEqual({ status: 'exhausted' })
    expect(calls).toBe(4)
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
})
