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

export function workErrorMessage(reason: string): string {
  switch (reason) {
    case 'conflict': return 'This task changed. Read it again before updating it.'
    case 'scope_forbidden': return 'You do not have access to move this task to that scope.'
    case 'title_required': return 'Give the task a title.'
    case 'title_too_long': return 'That title is too long (200 characters at most).'
    case 'description_too_long': return 'That description is too long.'
    case 'date': return 'That is not a valid date.'
    case 'date_order': return 'The start date must be on or before the due date.'
    case 'priority': return 'Priority is Low, Medium or High.'
    case 'done_when': return 'The checklist has too many items, or an item is too long.'
    case 'context': return 'A context link is missing a name or is too long, or there are too many.'
    case 'parent': return 'That parent task is not available.'
    case 'parent_scope': return 'A task and the task it sits under must both be Personal or both be Workspace.'
    case 'self': return 'A task cannot be inside or blocked by itself.'
    case 'descendant': return 'A task cannot be moved inside one of its own subtasks.'
    case 'too_deep': return 'Tasks can only be nested a few levels deep.'
    case 'cycle': return 'That would make two tasks wait on each other.'
    case 'too_many': return 'A task can be blocked by up to 50 others.'
    case 'blocker': return 'A blocking task is not available.'
    case 'assignee': return 'That person or agent cannot be given this task.'
    case 'personal_assignee': return 'A personal task can only be assigned to you or an agent you can use.'
    case 'reviewer': return 'That person cannot review this task.'
    case 'personal_reviewer': return 'A personal task can only be reviewed by you.'
    case 'archived': return 'Restore the task first.'
    case 'comment_required': return 'Write a comment first.'
    case 'comment_too_long': return 'That comment is too long.'
    default: return 'That change is not allowed.'
  }
}

export function workErrorStatus(reason: string): number {
  if (reason === 'scope_forbidden') return 403
  return reason === 'archived' || reason === 'conflict' ? 409 : 400
}
