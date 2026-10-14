/**
 * What the List, Board and Timeline show: filtering, searching and grouping tasks. Pure, so the three views agree.
 */
import type { WorkItem, WorkStatus } from '@overlay/app-core'
import { compareRanked } from './rank'
import { WORK_STATUSES } from './status'

export const WORK_FILTERS = ['all', 'needs-you', 'mine'] as const
export type WorkFilter = (typeof WORK_FILTERS)[number]

export const WORK_FILTER_LABELS: Record<WorkFilter, string> = {
  all: 'Everything',
  'needs-you': 'Needs you',
  mine: 'Assigned to me',
}

export const WORK_FILTER_PARAM = 'filter'

export function parseWorkFilter(value: unknown): WorkFilter {
  return typeof value === 'string' && (WORK_FILTERS as readonly string[]).includes(value) ? (value as WorkFilter) : 'all'
}

/** The person looking: their user id and their principal id in the workspace. */
export type WorkViewer = { userId: string; principalId: string }

/** The order the List groups tasks in: what needs attention first, finished work last. */
export const LIST_STATUS_ORDER: readonly WorkStatus[] = ['review', 'progress', 'todo', 'backlog', 'done']

/** The Board's columns, left to right. */
export const BOARD_STATUS_ORDER: readonly WorkStatus[] = WORK_STATUSES

/** Who reviews a task: the named reviewer, or its creator when nobody was named. */
export function reviewerOf(item: Pick<WorkItem, 'reviewerUserId' | 'createdBy'>): string {
  return item.reviewerUserId ?? item.createdBy
}

/**
 * Waiting on this person: a task in review that they review, or a blocked task that is theirs (assigned to them, or
 * reviewed by them). Done and archived tasks never wait on anyone.
 */
export function needsViewer(item: WorkItem, viewer: WorkViewer): boolean {
  if (item.archivedAt !== null || item.status === 'done') return false
  if (item.status === 'review' && reviewerOf(item) === viewer.userId) return true
  return item.blocked && (item.assigneePrincipalId === viewer.principalId || reviewerOf(item) === viewer.userId)
}

export function assignedToViewer(item: WorkItem, viewer: WorkViewer): boolean {
  return item.assigneePrincipalId === viewer.principalId || item.reviewerUserId === viewer.userId
}

export function matchesFilter(item: WorkItem, filter: WorkFilter, viewer: WorkViewer | null): boolean {
  if (filter === 'all') return true
  if (!viewer) return false
  return filter === 'needs-you' ? needsViewer(item, viewer) : assignedToViewer(item, viewer)
}

/** Every word typed must appear in the title or the description (case-insensitive). */
export function matchesQuery(item: WorkItem, query: string): boolean {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (terms.length === 0) return true
  const haystack = `${item.title}\n${item.description ?? ''}`.toLowerCase()
  return terms.every((term) => haystack.includes(term))
}

export function filterWork(items: readonly WorkItem[], options: { filter: WorkFilter; query: string; viewer: WorkViewer | null }): WorkItem[] {
  return items.filter((item) => matchesFilter(item, options.filter, options.viewer) && matchesQuery(item, options.query))
}

export function sortByRank<T extends Pick<WorkItem, 'rank' | 'createdAt' | 'id'>>(items: readonly T[]): T[] {
  return [...items].sort(compareRanked)
}

export type WorkGroup = { status: WorkStatus; items: WorkItem[] }

/** Tasks grouped by status in `order`, each group in rank order. Empty groups are left out. */
export function groupByStatus(items: readonly WorkItem[], order: readonly WorkStatus[] = LIST_STATUS_ORDER): WorkGroup[] {
  const sorted = sortByRank(items)
  return order
    .map((status) => ({ status, items: sorted.filter((item) => item.status === status) }))
    .filter((group) => group.items.length > 0)
}

/** Every status column, empty ones included (the Board shows them all). */
export function columnsByStatus(items: readonly WorkItem[]): WorkGroup[] {
  const sorted = sortByRank(items)
  return BOARD_STATUS_ORDER.map((status) => ({ status, items: sorted.filter((item) => item.status === status) }))
}

export function countOpen(items: readonly WorkItem[]): number {
  return items.filter((item) => item.status !== 'done' && item.archivedAt === null).length
}

/** The title of a task's parent, for the list's "inside" column. Null for a top-level task or an unreadable parent. */
export function parentTitle(item: WorkItem, byId: ReadonlyMap<string, WorkItem>): string | null {
  return item.parentId ? byId.get(item.parentId)?.title ?? null : null
}

/** Ids of tasks that have at least one child among `items` (objectives). */
export function parentIds(items: readonly WorkItem[]): Set<string> {
  const ids = new Set<string>()
  for (const item of items) if (item.parentId) ids.add(item.parentId)
  return ids
}
