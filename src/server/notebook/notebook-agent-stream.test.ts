import { describe, expect, test } from 'vitest'
import {
  parseNotebookCursor,
  parseNotebookSnapshotCursor,
  projectNotebookTerminal,
  projectNotebookTranscriptStep,
} from './notebook-agent-stream'

const edit = {
  id: 'edit-1',
  description: 'Replace the line',
  startLine: 1,
  endLine: 1,
  originalLines: ['old'],
  newLines: ['new'],
}

const step = {
  sequence: 2,
  executionGeneration: 4,
  persistence: {
    content: '',
    parts: [
      { type: 'text', text: 'A reply.' },
      { type: 'reasoning', text: 'private' },
      { type: 'tool-invocation', toolInvocation: {
        toolName: 'read_note', toolInput: {}, state: 'output-available',
      } },
      { type: 'tool-invocation', toolInvocation: {
        toolName: 'propose_edit',
        toolInput: { start_line: 1, new_content: 'x'.repeat(8_001) },
        state: 'output-available',
        toolOutput: { success: true, edit },
      } },
      { type: 'tool-invocation', toolInvocation: {
        toolName: 'propose_edit', toolInput: {},
        state: 'output-available',
        toolOutput: { success: false, edit },
      } },
      { type: 'tool-invocation', toolInvocation: {
        toolName: 'computer_browser', toolInput: {}, state: 'output-available',
      } },
    ],
  },
}

describe('Notebook public stream projection', () => {
  test('projects text and allowed calls, exposes only successful validated proposals', () => {
    const events = projectNotebookTranscriptStep({ runId: 'run-1', step })

    expect(events.map(event => event.type)).toEqual([
      'text', 'tool_call', 'tool_call', 'edit_proposal', 'tool_call',
    ])
    expect(events[0]).toMatchObject({ text: 'A reply.', sequence: 2, cursor: '2.0' })
    expect(events.map(event => event.type === 'tool_call' ? event.tool : undefined))
      .toEqual([undefined, 'read_note', 'propose_edit', undefined, 'propose_edit'])
    expect(events[2]).toMatchObject({
      toolInput: { new_content: `${'x'.repeat(8_000)}\n[truncated in log]` },
    })
    expect(events.find(event => event.type === 'edit_proposal')).toMatchObject({ edit })
    expect(JSON.stringify(events)).not.toContain('private')
    expect(JSON.stringify(events)).not.toContain('computer_browser')
    expect(events[2]?.eventId).toBe('run-1:4:2:3')
    expect(events[3]?.eventId).toBe('run-1:4:2:proposal:edit-1')
  })

  test('replay cursors omit prior transcript parts and retain a stable proposal event', () => {
    const events = projectNotebookTranscriptStep({
      runId: 'run-1',
      step,
      afterCursor: { sequence: 2, index: 2 },
    })
    expect(events.map(event => event.type)).toEqual(['tool_call', 'edit_proposal', 'tool_call'])
    expect(events[1]?.eventId).toBe('run-1:4:2:proposal:edit-1')
    expect(parseNotebookCursor('2.3')).toEqual({ sequence: 2, index: 3 })
    expect(parseNotebookCursor('invalid')).toBeNull()
    expect(parseNotebookCursor('9007199254740992.0')).toBeNull()
    expect(parseNotebookSnapshotCursor('s:4:model:2:37')).toEqual({
      generation: 4,
      receiptId: 'model:2',
      offset: 37,
    })
    expect(parseNotebookSnapshotCursor('s:4:model:2:9007199254740992')).toBeNull()
  })

  test('terminal events are stable and do not expose failure internals', () => {
    expect(projectNotebookTerminal({ runId: 'run-1', status: 'failed' })).toEqual([
      { type: 'error', error: 'The Notebook run failed.', eventId: 'run-1:terminal:error' },
      { type: 'done', eventId: 'run-1:terminal:done' },
    ])
    expect(projectNotebookTerminal({ runId: 'run-1', status: 'completed' })).toEqual([
      { type: 'done', eventId: 'run-1:terminal:done' },
    ])
  })
})
