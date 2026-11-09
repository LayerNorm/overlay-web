import { describe, expect, test } from 'vitest'
import {
  parseNotebookCursor,
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
    expect(events[2]?.eventId).toBe('run-1:4:2:6')
    expect(events[3]?.eventId).toBe('run-1:4:2:7')
  })

  test('replay resumes after a tool call without dropping its successful proposal', () => {
    const events = projectNotebookTranscriptStep({
      runId: 'run-1',
      step,
      afterCursor: { sequence: 2, index: 6 },
    })
    expect(events.map(event => event.type)).toEqual(['edit_proposal', 'tool_call'])
    expect(events[0]).toMatchObject({
      eventId: 'run-1:4:2:7',
      cursor: '2.7',
      edit,
    })
    expect(parseNotebookCursor('2.3')).toEqual({ sequence: 2, index: 3 })
    expect(parseNotebookCursor('invalid')).toBeNull()
    expect(parseNotebookCursor('9007199254740992.0')).toBeNull()
  })

  test('projects only complete persisted text chunks', () => {
    const events = projectNotebookTranscriptStep({
      runId: 'run-1',
      step: {
        ...step,
        persistence: { content: 'Settled response.', parts: [] },
      },
    })
    expect(events.filter(event => event.type === 'text')).toEqual([
      expect.objectContaining({ type: 'text', text: 'Settled response.' }),
    ])
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
