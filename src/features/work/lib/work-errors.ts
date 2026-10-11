import { ApiRequestError } from '@overlay/api-client'

/** HTTP 409: the item changed since the screen loaded (`expectedUpdatedAt` no longer matches). */
export function isWorkConflict(error: unknown): boolean {
  return error instanceof ApiRequestError && error.status === 409
}

/**
 * What to tell the person when a request fails. `action` finishes "Could not …" ("save that change"). The server's own
 * message is used when it sent a readable one (a bad assignee, an over-long title), a conflict gets its own wording,
 * and a gateway or network failure falls back to the generic line.
 */
export function describeWorkError(error: unknown, action: string): string {
  if (isWorkConflict(error)) return 'Someone else changed this task. It has been reloaded; try your change again.'
  if (error instanceof ApiRequestError) {
    if (error.status === 403) return 'You do not have permission to change this task.'
    if (error.status >= 400 && error.status < 500 && error.message) return error.message
  }
  return `Could not ${action}. Check your connection and try again.`
}
