import { createHash } from 'node:crypto'
import type { NotebookEdit } from '@overlay/app-core'

const MAX_NOTE_CONTENT_CHARS = 400_000

class NotebookEditValidationError extends Error {}

export function readFrozenNotebook(note: { title: string; content: string }) {
  const lines = note.content.split('\n')
  return {
    title: note.title || 'Untitled',
    lineCount: lines.length,
    content: lines.map((line, index) => `${index + 1}: ${line}`).join('\n'),
    isEmpty: lines.length === 1 && lines[0]!.trim() === '',
  }
}

export function buildNotebookEditProposal(input: {
  runId: string
  toolCallId: string
  content: string
  description: unknown
  startLine: unknown
  endLine: unknown
  newContent: unknown
}): NotebookEdit {
  const lines = input.content.split('\n')
  if (typeof input.description !== 'string' || typeof input.newContent !== 'string'
    || input.description.length > 200 || input.newContent.length > MAX_NOTE_CONTENT_CHARS
    || !Number.isSafeInteger(input.startLine) || !Number.isSafeInteger(input.endLine)
    || (input.startLine as number) < 1 || (input.endLine as number) < (input.startLine as number)
    || (input.endLine as number) > lines.length) {
    throw new NotebookEditValidationError('Edit range or content is invalid for the frozen note.')
  }
  const startLine = input.startLine as number
  const endLine = input.endLine as number
  return {
    id: `edit-${createHash('sha256').update(JSON.stringify([input.runId, input.toolCallId])).digest('hex').slice(0, 24)}`,
    description: input.description,
    startLine,
    endLine,
    originalLines: lines.slice(startLine - 1, endLine),
    newLines: input.newContent === '' ? [] : input.newContent.split('\n'),
  }
}

export function proposeFrozenNotebookEdit(input: Parameters<typeof buildNotebookEditProposal>[0]) {
  try {
    const edit = buildNotebookEditProposal(input)
    return { success: true, editId: edit.id, edit, message: `Edit proposed (lines ${edit.startLine}-${edit.endLine})` }
  } catch (error) {
    if (!(error instanceof NotebookEditValidationError)) throw error
    return {
      success: false,
      error: `${error.message} Call read_note for the frozen line numbers, then submit a corrected propose_edit. No edit was proposed.`,
      lineCount: input.content.split('\n').length,
    }
  }
}
