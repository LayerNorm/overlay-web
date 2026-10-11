import type { WorkItemDoc, WorkItemPriority, WorkItemStatus } from '@overlay/api-client'
import {
  WORK_ITEM_PRIORITIES as SHARED_PRIORITIES,
  WORK_ITEM_PRIORITY_META,
  WORK_ITEM_STATUSES as SHARED_STATUSES,
  WORK_ITEM_STATUS_META,
  workItemKey as formatWorkItemKey,
  type WorkItemPriority as SharedPriority,
  type WorkItemStatus as SharedStatus,
} from '@/shared/work/work-items'

export type { WorkItemDoc, WorkItemPriority, WorkItemStatus }

// The status and priority lists live in `@/shared/work/work-items`. The API client package cannot import app code, so
// it spells the same unions out; this makes the build fail if the two ever differ.
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false
type AssertTrue<T extends true> = T
export type WorkItemTypesInSync = [
  AssertTrue<Equal<WorkItemStatus, SharedStatus>>,
  AssertTrue<Equal<WorkItemPriority, SharedPriority>>,
]

// `assigneeUserId` on a work item holds the workspace principal id (a person or,
// later, an agent) — resolve display names through workspace management people.

export const WORK_ITEM_STATUS_OPTIONS: readonly { id: WorkItemStatus; label: string }[] =
  SHARED_STATUSES.map((id) => ({ id, label: WORK_ITEM_STATUS_META[id].label }))

/** Most urgent first, "No priority" last. */
export const WORK_ITEM_PRIORITY_OPTIONS: readonly { id: WorkItemPriority; label: string }[] =
  [...SHARED_PRIORITIES]
    .sort((a, b) => WORK_ITEM_PRIORITY_META[b].rank - WORK_ITEM_PRIORITY_META[a].rank)
    .map((id) => ({ id, label: WORK_ITEM_PRIORITY_META[id].label }))

export function workItemKey(item: Pick<WorkItemDoc, 'itemNumber'>): string {
  return formatWorkItemKey(item.itemNumber)
}

export function workItemStatusLabel(status: WorkItemStatus): string {
  return WORK_ITEM_STATUS_META[status]?.label ?? status
}

export function workItemPriorityLabel(priority: WorkItemPriority): string {
  return WORK_ITEM_PRIORITY_META[priority]?.label ?? priority
}

const STATUS_COLOR: Record<WorkItemStatus, string | null> = {
  todo: null,
  in_progress: '#6366f1',
  in_review: '#d97706',
  done: '#059669',
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

/**
 * Pill text/border classes per status. The status color is mixed into the theme's own text color, so the pill is
 * dark-on-light in the light theme and light-on-dark in the dark theme.
 */
export function workItemStatusPillClass(status: WorkItemStatus): string {
  const color = STATUS_COLOR[status]
  if (!color) return 'text-[var(--muted)] border-[var(--border)]'
  return `text-[color-mix(in_srgb,${color}_70%,var(--foreground))] border-[color-mix(in_srgb,${color}_45%,transparent)]`
}

export function workItemPriorityClass(priority: WorkItemPriority): string {
  switch (priority) {
    case 'urgent': return 'text-[var(--danger)]'
    case 'high': return 'text-[var(--warning)]'
    case 'medium': return 'text-[var(--muted)]'
    default: return 'text-[var(--muted-light)]'
  }
}

const SHORT_DATE: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' }

/**
 * A start or due date. These are calendar days stored as UTC midnight, so they are shown in UTC: a due date of
 * "Oct 14" reads the same in every time zone.
 */
export function formatWorkItemDay(ts: number | undefined): string {
  if (!ts) return ''
  return new Date(ts).toLocaleDateString('en-US', { ...SHORT_DATE, timeZone: 'UTC' })
}

/** A moment in time (when something was created): shown in the viewer's own time zone. */
export function formatWorkItemTimestamp(ts: number | undefined, timeZone?: string): string {
  if (!ts) return ''
  return new Date(ts).toLocaleDateString('en-US', { ...SHORT_DATE, ...(timeZone ? { timeZone } : {}) })
}

export function workItemInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  const first = parts[0]?.[0] ?? ''
  const last = parts.length > 1 ? parts[parts.length - 1]![0] ?? '' : (parts[0]?.[1] ?? '')
  return (first + last).toUpperCase() || '?'
}
