import type { UpdateWorkItemRequest, WorkItem, WorkStatus } from '@overlay/app-core'
import { rankBetween } from '@/shared/work/rank'
import { sortByRank } from '@/shared/work/query'

/**
 * Local (optimistic) edits to the task list. The server stays the authority: every change is replaced by the
 * server's version when it answers, or rolled back if it refuses.
 */

/** A rank that puts a task last in a column, as the server does when a task changes status. */
export function endRankOf(items: readonly WorkItem[], status: WorkStatus, excludeId?: string): string {
  const column = sortByRank(items.filter((item) => item.status === status && item.id !== excludeId))
  return rankBetween(column.at(-1)?.rank ?? null, null)
}

/** Applies a patch the way the server will, so the screen can move before the answer arrives. */
export function applyItemPatch(item: WorkItem, patch: UpdateWorkItemRequest, options: { now: number; endRank?: string }): WorkItem {
  const next: WorkItem = { ...item, updatedAt: options.now }
  if (patch.title !== undefined) next.title = patch.title.trim()
  if (patch.description !== undefined) next.description = patch.description
  if (patch.status !== undefined && patch.status !== item.status) {
    next.status = patch.status
    if (options.endRank) next.rank = options.endRank
  }
  if (patch.blocked !== undefined) next.blocked = patch.blocked
  if (patch.priority !== undefined) next.priority = patch.priority
  if (patch.assigneePrincipalId !== undefined) next.assigneePrincipalId = patch.assigneePrincipalId
  if (patch.reviewerUserId !== undefined) next.reviewerUserId = patch.reviewerUserId
  if (patch.startDate !== undefined) next.startDate = patch.startDate
  if (patch.dueDate !== undefined) next.dueDate = patch.dueDate
  if (patch.parentId !== undefined) next.parentId = patch.parentId
  if (patch.doneWhen !== undefined) next.doneWhen = patch.doneWhen
  if (patch.context !== undefined) next.context = patch.context
  return next
}

/** Replaces the task with the same id, or adds it. */
export function upsertItem(items: readonly WorkItem[], item: WorkItem): WorkItem[] {
  const index = items.findIndex((existing) => existing.id === item.id)
  if (index < 0) return [...items, item]
  const next = [...items]
  next[index] = item
  return next
}

export function removeItem(items: readonly WorkItem[], id: string): WorkItem[] {
  return items.filter((item) => item.id !== id)
}

/**
 * Where a dropped task goes in a column: between `afterId` and `beforeId` (either may be absent), using the neighbours'
 * current ranks. The server computes its own rank from the live neighbours; this one only has to look right meanwhile.
 */
export function rankForDrop(items: readonly WorkItem[], args: { id: string; status: WorkStatus; afterId?: string | null; beforeId?: string | null }): string {
  const column = items.filter((item) => item.status === args.status && item.id !== args.id)
  const above = args.afterId ? column.find((item) => item.id === args.afterId) : undefined
  const below = args.beforeId ? column.find((item) => item.id === args.beforeId) : undefined
  if (!above && !below) return endRankOf(items, args.status, args.id)
  return rankBetween(above?.rank ?? null, below?.rank ?? null)
}

/** Initials for an avatar: first letters of up to two words. */
export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return '?'
  const letters = words.length === 1 ? words[0]!.slice(0, 1) : `${words[0]!.slice(0, 1)}${words.at(-1)!.slice(0, 1)}`
  return letters.toUpperCase()
}
