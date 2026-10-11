import type { WorkItemDoc, WorkItemPriority, WorkItemStatus } from '@overlay/api-client'

export type { WorkItemDoc, WorkItemPriority, WorkItemStatus }

// `assigneeUserId` on a work item holds the workspace principal id (a person or,
// later, an agent) — resolve display names through workspace management people.

export const WORK_ITEM_STATUSES: readonly { id: WorkItemStatus; label: string }[] = [
  { id: 'todo', label: 'To do' },
  { id: 'in_progress', label: 'In progress' },
  { id: 'in_review', label: 'In review' },
  { id: 'done', label: 'Done' },
]

export const WORK_ITEM_PRIORITIES: readonly { id: WorkItemPriority; label: string }[] = [
  { id: 'none', label: 'No priority' },
  { id: 'urgent', label: 'Urgent' },
  { id: 'high', label: 'High' },
  { id: 'medium', label: 'Medium' },
  { id: 'low', label: 'Low' },
]

export function workItemKey(item: Pick<WorkItemDoc, 'itemNumber'>): string {
  return `OVR-${item.itemNumber}`
}

export function workItemStatusLabel(status: WorkItemStatus): string {
  return WORK_ITEM_STATUSES.find((s) => s.id === status)?.label ?? status
}

export function workItemPriorityLabel(priority: WorkItemPriority): string {
  return WORK_ITEM_PRIORITIES.find((p) => p.id === priority)?.label ?? priority
}

/** Colored dot classes per status, matching the sidebar/table markers. */
export function workItemStatusDotClass(status: WorkItemStatus): string {
  switch (status) {
    case 'in_progress': return 'bg-[#818cf8]'
    case 'in_review': return 'bg-[#f59e0b]'
    case 'done': return 'bg-[#10b981]'
    default: return 'bg-[#71717a]'
  }
}

/** Pill text/border color classes per status. */
export function workItemStatusPillClass(status: WorkItemStatus): string {
  switch (status) {
    case 'in_progress': return 'text-[#c7d2fe] border-[#3730a3]'
    case 'in_review': return 'text-[#fcd9a8] border-[#7c4a12]'
    case 'done': return 'text-[#a7f3d0] border-[#065f46]'
    default: return 'text-[var(--muted)] border-[var(--border)]'
  }
}

export function workItemPriorityClass(priority: WorkItemPriority): string {
  switch (priority) {
    case 'urgent': return 'text-[var(--danger)]'
    case 'high': return 'text-[var(--warning)]'
    case 'medium': return 'text-[var(--muted)]'
    default: return 'text-[var(--muted-light)]'
  }
}

export function formatWorkItemDate(ts: number | undefined): string {
  if (!ts) return ''
  return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
}

export function workItemInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  const first = parts[0]?.[0] ?? ''
  const last = parts.length > 1 ? parts[parts.length - 1]![0] ?? '' : (parts[0]?.[1] ?? '')
  return (first + last).toUpperCase() || '?'
}
