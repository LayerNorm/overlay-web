import { describe, expect, test } from 'vitest'
import { buildNotebookEditProposal, proposeFrozenNotebookEdit, readFrozenNotebook } from './notebook-agent-utils'

describe('Notebook durable tools', () => {
  test('invalid proposal ranges return actionable feedback and can be corrected against the same snapshot', () => {
    const input = { runId: 'run', toolCallId: 'invalid', content: 'one\ntwo\nthree',
      description: 'replace last line', startLine: 5, endLine: 6, newContent: 'updated' }
    const invalid = proposeFrozenNotebookEdit(input)
    expect(invalid).toMatchObject({ success: false, lineCount: 3, error: expect.stringContaining('Call read_note') })
    expect(invalid).not.toHaveProperty('edit')
    expect(proposeFrozenNotebookEdit({ ...input, toolCallId: 'corrected', startLine: 3, endLine: 3 }))
      .toMatchObject({ success: true, edit: { originalLines: ['three'], newLines: ['updated'] } })
    expect(input.content).toBe('one\ntwo\nthree')
  })

  test('read_note returns numbered lines from the frozen snapshot', () => {
    expect(readFrozenNotebook({ title: 'Goals', content: 'one\ntwo' })).toEqual({
      title: 'Goals',
      lineCount: 2,
      content: '1: one\n2: two',
      isEmpty: false,
    })
  })

  test('proposals validate bounds, remain proposals, and use stable tool-call IDs', () => {
    const frozenContent = 'one\ntwo'
    const first = buildNotebookEditProposal({
      runId: 'personal:run',
      toolCallId: 'call_1',
      content: frozenContent,
      description: 'replace second line',
      startLine: 2,
      endLine: 2,
      newContent: 'new',
    })
    const replay = buildNotebookEditProposal({
      runId: 'personal:run',
      toolCallId: 'call_1',
      content: frozenContent,
      description: 'replace second line',
      startLine: 2,
      endLine: 2,
      newContent: 'new',
    })

    expect(first).toEqual(replay)
    expect(first.originalLines).toEqual(['two'])
    expect(first.newLines).toEqual(['new'])
    expect(frozenContent).toBe('one\ntwo')
    expect(() => buildNotebookEditProposal({
      runId: 'personal:run',
      toolCallId: 'call_2',
      content: frozenContent,
      description: 'outside the note',
      startLine: 1,
      endLine: 3,
      newContent: 'no',
    })).toThrow('Edit range or content is invalid')
    expect(() => buildNotebookEditProposal({
      runId: 'personal:run',
      toolCallId: 'call_3',
      content: frozenContent,
      description: 'fractional line',
      startLine: 1.5,
      endLine: 2,
      newContent: 'no',
    })).toThrow('Edit range or content is invalid')
    expect(() => buildNotebookEditProposal({
      runId: 'personal:run',
      toolCallId: 'call_4',
      content: frozenContent,
      description: 'replace second line',
      startLine: 2,
      endLine: 2,
      newContent: 'x'.repeat(400_001),
    })).toThrow('Edit range or content is invalid')
  })
})
