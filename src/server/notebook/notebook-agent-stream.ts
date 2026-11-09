import type { NotebookAgentStreamEvent, NotebookEdit } from '@overlay/app-core'

const notebookTools = new Set(['search_knowledge', 'read_note', 'propose_edit', 'finish'])

function validEdit(value: unknown): value is NotebookEdit {
  if (!value || typeof value !== 'object') return false
  const edit = value as Record<string, unknown>
  return typeof edit.id === 'string' && typeof edit.description === 'string'
    && Number.isSafeInteger(edit.startLine) && Number.isSafeInteger(edit.endLine)
    && (edit.startLine as number) >= 1 && (edit.endLine as number) >= (edit.startLine as number)
    && Array.isArray(edit.originalLines) && edit.originalLines.every(line => typeof line === 'string')
    && Array.isArray(edit.newLines) && edit.newLines.every(line => typeof line === 'string')
}

function transcriptEvent(
  type: NotebookAgentStreamEvent['type'],
  runId: string,
  generation: number,
  sequence: number,
  index: number,
  value: Record<string, unknown>,
): NotebookAgentStreamEvent {
  return {
    ...value,
    type,
    eventId: `${runId}:${generation}:${sequence}:${index}`,
    sequence,
    cursor: `${sequence}.${index}`,
  } as NotebookAgentStreamEvent
}

function boundedToolInput(tool: string, input: Record<string, unknown>): Record<string, unknown> {
  if (tool !== 'propose_edit' || typeof input.new_content !== 'string' || input.new_content.length <= 8_000) return input
  return { ...input, new_content: `${input.new_content.slice(0, 8_000)}\n[truncated in log]` }
}

export function projectNotebookTranscriptStep(input: {
  runId: string
  step: { sequence: number; executionGeneration: number; persistence: { content: string; parts: Array<Record<string, unknown>> } }
  afterCursor?: { sequence: number; index: number }
}): NotebookAgentStreamEvent[] {
  const { step, runId } = input
  const events: NotebookAgentStreamEvent[] = []
  const parts = step.persistence.parts.length
    ? step.persistence.parts
    : step.persistence.content ? [{ type: 'text', text: step.persistence.content }] : []
  for (const [index, part] of parts.entries()) {
    if (input.afterCursor?.sequence === step.sequence && index <= input.afterCursor.index) continue
    if (part.type === 'text' && typeof part.text === 'string' && part.text) {
      events.push(transcriptEvent('text', runId, step.executionGeneration, step.sequence, index, { text: part.text }))
      continue
    }
    if (part.type !== 'tool-invocation' || !part.toolInvocation || typeof part.toolInvocation !== 'object') continue
    const invocation = part.toolInvocation as Record<string, unknown>
    const name = invocation.toolName
    if (typeof name !== 'string' || !notebookTools.has(name)) continue
    const toolInput = invocation.toolInput && typeof invocation.toolInput === 'object'
      ? invocation.toolInput as Record<string, unknown> : {}
    events.push(transcriptEvent('tool_call', runId, step.executionGeneration, step.sequence, index, {
      tool: name,
      toolInput: boundedToolInput(name, toolInput),
    }))
    if (name !== 'propose_edit' || invocation.state !== 'output-available'
      || !invocation.toolOutput || typeof invocation.toolOutput !== 'object') continue
    const output = invocation.toolOutput as Record<string, unknown>
    if (output.success !== true || !validEdit(output.edit)) continue
    events.push({
      type: 'edit_proposal',
      edit: output.edit,
      eventId: `${runId}:${step.executionGeneration}:${step.sequence}:proposal:${output.edit.id}`,
      sequence: step.sequence,
      cursor: `${step.sequence}.${index}`,
    })
  }
  return events
}

export function parseNotebookCursor(cursor: string | undefined): { sequence: number; index: number } | null {
  if (!cursor) return null
  const match = /^(\d+)\.(\d+)$/.exec(cursor)
  if (!match) return null
  const sequence = Number(match[1])
  const index = Number(match[2])
  if (!Number.isSafeInteger(sequence) || !Number.isSafeInteger(index)) return null
  return { sequence, index }
}

export function parseNotebookSnapshotCursor(
  cursor: string | undefined,
): { generation: number; receiptId: string; offset: number } | null {
  if (!cursor) return null
  const match = /^s:(\d+):(model:\d+):(\d+)$/.exec(cursor)
  if (!match) return null
  const generation = Number(match[1])
  const offset = Number(match[3])
  if (!Number.isSafeInteger(generation) || !Number.isSafeInteger(offset)) return null
  return { generation, receiptId: match[2]!, offset }
}

export function projectNotebookTerminal(input: { runId: string; status: string }): NotebookAgentStreamEvent[] {
  const events: NotebookAgentStreamEvent[] = []
  if (input.status === 'failed') {
    events.push({ type: 'error', error: 'The Notebook run failed.', eventId: `${input.runId}:terminal:error` })
  }
  events.push({ type: 'done', eventId: `${input.runId}:terminal:done` })
  return events
}
