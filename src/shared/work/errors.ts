/**
 * Convex refuses a task change with `WORK_INVALID:<reason>`. These turn a reason into a plain-language message and an
 * HTTP status, so the API and the UI say the same thing.
 */

const PREFIX = 'WORK_INVALID:'

export function parseWorkErrorReason(error: unknown): string | null {
  const data = typeof error === 'object' && error !== null && 'data' in error ? error.data : undefined
  const message = typeof data === 'string' ? data : error instanceof Error ? error.message : typeof error === 'string' ? error : ''
  const index = message.indexOf(PREFIX)
  if (index < 0) return null
  return message.slice(index + PREFIX.length).split(/[\s\n:]/)[0] || null
}

const WORK_ERROR_MESSAGES: Readonly<Record<string, string>> = {
  conflict: 'This task changed. Read it again before updating it.',
  scope_forbidden: 'You do not have access to move this task to that scope.',
  title_required: 'Give the task a title.',
  title_too_long: 'That title is too long (200 characters at most).',
  description_too_long: 'That description is too long.',
  date: 'That is not a valid date.',
  date_order: 'The start date must be on or before the due date.',
  priority: 'Priority is Low, Medium or High.',
  done_when: 'The checklist has too many items, or an item is too long.',
  context: 'A context link is missing a name or is too long, or there are too many.',
  parent: 'That parent task is not available.',
  parent_scope: 'A task and the task it sits under must both be Personal or both be Workspace.',
  self: 'A task cannot be inside or blocked by itself.',
  descendant: 'A task cannot be moved inside one of its own subtasks.',
  too_deep: 'Tasks can only be nested a few levels deep.',
  cycle: 'That would make two tasks wait on each other.',
  too_many: 'A task can be blocked by up to 50 others.',
  blocker: 'A blocking task is not available.',
  assignee: 'That person or agent cannot be given this task.',
  personal_assignee: 'A personal task can only be assigned to you or an agent you can use.',
  reviewer: 'That person cannot review this task.',
  personal_reviewer: 'A personal task can only be reviewed by you.',
  archived: 'Restore the task first.',
  comment_required: 'Write a comment first.',
  comment_too_long: 'That comment is too long.',
}

export function workErrorMessage(reason: string): string {
  return Object.hasOwn(WORK_ERROR_MESSAGES, reason)
    ? WORK_ERROR_MESSAGES[reason]
    : 'That change is not allowed.'
}

export function workErrorStatus(reason: string): number {
  if (reason === 'scope_forbidden') return 403
  return reason === 'archived' || reason === 'conflict' ? 409 : 400
}
