import posthog from 'posthog-js'
import type { UpdateWorkItemRequest } from '@overlay/app-core'

/** What a change to a task is called in analytics: the kind of change, never its words. */
export function describeWorkChange(patch: UpdateWorkItemRequest): { event: string; properties: Record<string, unknown> } {
  const fields = Object.keys(patch).sort()
  if (patch.status !== undefined) return { event: 'work_task_status_changed', properties: { status: patch.status } }
  if (patch.startDate !== undefined || patch.dueDate !== undefined) return { event: 'work_task_dates_changed', properties: {} }
  if (patch.assigneePrincipalId !== undefined) return { event: 'work_task_assigned', properties: { cleared: patch.assigneePrincipalId === null } }
  if (patch.blockedBy !== undefined) return { event: 'work_task_dependencies_changed', properties: { count: patch.blockedBy.length } }
  return { event: 'work_task_updated', properties: { fields } }
}

/** Analytics must never get in the way of the work: a blocked or missing SDK is ignored. */
export function trackWork(event: string, properties: Record<string, unknown> = {}): void {
  try {
    // Without a token the SDK never starts, and capturing anyway only logs a complaint.
    if (!(posthog as unknown as { __loaded?: boolean }).__loaded) return
    posthog.capture(event, properties)
  } catch {
    // Not captured.
  }
}
