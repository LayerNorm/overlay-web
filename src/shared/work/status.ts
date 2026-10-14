/**
 * Work (tasks, board, timeline): the fixed vocabulary shared by Convex, the server and the UI.
 * Statuses are intentionally not configurable in v1; "blocked" is a flag, and "canceled" is archive.
 */

export const WORK_STATUSES = ['backlog', 'todo', 'progress', 'review', 'done'] as const
export type WorkStatus = (typeof WORK_STATUSES)[number]

export const WORK_STATUS_LABELS: Record<WorkStatus, string> = {
  backlog: 'Backlog',
  todo: 'Todo',
  progress: 'In progress',
  review: 'In review',
  done: 'Done',
}

/** What a new task starts as when the creator does not say. */
export const DEFAULT_WORK_STATUS: WorkStatus = 'todo'

export const WORK_PRIORITIES = [1, 2, 3] as const
export type WorkPriority = (typeof WORK_PRIORITIES)[number]
export const WORK_PRIORITY_LABELS: Record<WorkPriority, string> = { 1: 'Low', 2: 'Medium', 3: 'High' }
export const DEFAULT_WORK_PRIORITY: WorkPriority = 2

export const WORK_CONTEXT_TYPES = ['file', 'note', 'chat', 'link'] as const
export type WorkContextType = (typeof WORK_CONTEXT_TYPES)[number]

export const WORK_EVENT_KINDS = [
  'created',
  'status',
  'assignee',
  'reviewer',
  'priority',
  'dates',
  'title',
  'blocked',
  'scope',
  'archived',
  'restored',
  'comment',
] as const
export type WorkEventKind = (typeof WORK_EVENT_KINDS)[number]

/** Length bounds, enforced by Convex and mirrored by the UI. */
export const WORK_LIMITS = {
  title: 200,
  description: 20_000,
  comment: 5_000,
  doneWhenItems: 50,
  doneWhenText: 300,
  contextItems: 50,
  contextLabel: 200,
  contextId: 2_000,
  blockedBy: 50,
  /** How deep parent links may go (objective, task, subtask). The UI shows one level to start. */
  maxDepth: 3,
  /** Rows one list will return before the client has to narrow by view. */
  listCap: 2_000,
} as const

export type WorkDoneWhen = { text: string; checked: boolean }
export type WorkContextRef = { type: WorkContextType; id: string; label: string }

export function parseWorkStatus(value: unknown): WorkStatus | undefined {
  return typeof value === 'string' && (WORK_STATUSES as readonly string[]).includes(value) ? (value as WorkStatus) : undefined
}

export function parseWorkPriority(value: unknown): WorkPriority | undefined {
  return typeof value === 'number' && (WORK_PRIORITIES as readonly number[]).includes(value) ? (value as WorkPriority) : undefined
}

/** A task that still needs doing. */
export function isOpenStatus(status: WorkStatus): boolean {
  return status !== 'done'
}

/** Calendar dates are plain `YYYY-MM-DD` strings so a due date never shifts with the viewer's timezone. */
export const WORK_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

export function isWorkDate(value: unknown): value is string {
  if (typeof value !== 'string' || !WORK_DATE_PATTERN.test(value)) return false
  const [y, m, d] = value.split('-').map(Number)
  const date = new Date(Date.UTC(y, m - 1, d))
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d
}

/** Why a title/dates/etc. was refused, or null when fine. Shared so the UI shows the same message Convex throws. */
export function validateWorkTitle(title: string): string | null {
  const trimmed = title.trim()
  if (!trimmed) return 'Give the task a title.'
  if (trimmed.length > WORK_LIMITS.title) return `Titles can be up to ${WORK_LIMITS.title} characters.`
  return null
}

export function validateWorkDates(startDate: string | null | undefined, dueDate: string | null | undefined): string | null {
  if (startDate != null && !isWorkDate(startDate)) return 'The start date is not a valid date.'
  if (dueDate != null && !isWorkDate(dueDate)) return 'The due date is not a valid date.'
  if (startDate != null && dueDate != null && startDate > dueDate) return 'The start date must be on or before the due date.'
  return null
}
