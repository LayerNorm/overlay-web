import type { AssignmentExecution } from './assignment-execution'
import type { WorkStatus } from './status'

/** A Work status glyph, or the alert glyph for a run that failed. */
export type AssignmentGlyph = WorkStatus | 'failed'

export type AssignmentWorkState = {
  glyph: AssignmentGlyph
  /** Which Work group the row belongs with. */
  group: 'progress' | 'review' | 'done'
  label: string
  tag?: { tone: 'neutral' | 'danger' | 'attention'; text: string }
}

/** How an agent run reads in Work vocabulary. Execution status stays the source; this only picks the presentation. */
export function assignmentWorkState(item: Pick<AssignmentExecution, 'status' | 'disposition'>): AssignmentWorkState {
  if (item.status === 'completed') {
    return { glyph: 'done', group: 'done', label: 'Done', ...(item.disposition === 'revision_requested' ? { tag: { tone: 'neutral' as const, text: 'Revision requested' } } : {}) }
  }
  if (item.status === 'failed') return { glyph: 'failed', group: 'done', label: 'Failed', tag: { tone: 'danger', text: 'Failed' } }
  if (item.status === 'cancelled') return { glyph: 'backlog', group: 'done', label: 'Cancelled', tag: { tone: 'neutral', text: 'Cancelled' } }
  if (item.status.startsWith('waiting_for_') && item.status !== 'waiting_for_children') {
    return { glyph: 'review', group: 'review', label: 'Needs you', tag: { tone: 'attention', text: 'Needs you' } }
  }
  return { glyph: 'progress', group: 'progress', label: 'In progress' }
}

export function isOpenAssignment(item: Pick<AssignmentExecution, 'status' | 'disposition'>): boolean {
  return assignmentWorkState(item).group !== 'done'
}

/** Page search matches the title and the agent's name, like task search matches titles. */
export function matchesAssignmentQuery(item: Pick<AssignmentExecution, 'title' | 'agentName'>, query: string): boolean {
  const needle = query.trim().toLowerCase()
  return needle === '' || `${item.title} ${item.agentName}`.toLowerCase().includes(needle)
}
