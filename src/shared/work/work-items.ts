/**
 * Shared contract for the Work feature: task items tracked at personal or workspace scope.
 * Isomorphic — safe for Convex, server, and client code.
 */

export const WORK_ITEM_STATUSES = ['todo', 'in_progress', 'in_review', 'done'] as const
export type WorkItemStatus = (typeof WORK_ITEM_STATUSES)[number]

export const WORK_ITEM_STATUS_META: Record<WorkItemStatus, { label: string }> = {
  todo: { label: 'To do' },
  in_progress: { label: 'In progress' },
  in_review: { label: 'In review' },
  done: { label: 'Done' },
}

export const WORK_ITEM_PRIORITIES = ['none', 'low', 'medium', 'high', 'urgent'] as const
export type WorkItemPriority = (typeof WORK_ITEM_PRIORITIES)[number]

export const WORK_ITEM_PRIORITY_META: Record<WorkItemPriority, { label: string; rank: number }> = {
  urgent: { label: 'Urgent', rank: 4 },
  high: { label: 'High', rank: 3 },
  medium: { label: 'Medium', rank: 2 },
  low: { label: 'Low', rank: 1 },
  none: { label: 'No priority', rank: 0 },
}

/** The page's three views; carried in the `?view=` query param like files/tools. */
export const WORK_ITEM_VIEWS = ['list', 'board', 'gantt'] as const
export type WorkItemView = (typeof WORK_ITEM_VIEWS)[number]
export const DEFAULT_WORK_ITEM_VIEW: WorkItemView = 'list'

export const WORK_ITEM_KEY_PREFIX = 'OVR'
export function workItemKey(itemNumber: number): string {
  return `${WORK_ITEM_KEY_PREFIX}-${itemNumber}`
}

/**
 * `orderKey` orders an item inside its status column (board) and within the task list.
 * Keys are fixed-width decimal strings so lexicographic order equals numeric order and a
 * new key can be inserted between two neighbors without rewriting the column.
 */
export const WORK_ITEM_ORDER_STEP = 1024
export const WORK_ITEM_ORDER_WIDTH = 20

export function toWorkItemOrderKey(value: number | bigint): string {
  return value.toString().padStart(WORK_ITEM_ORDER_WIDTH, '0')
}

/** The key after the largest of `existing`; for appending to the end of a column. */
export function nextWorkItemOrderKey(existing: readonly string[]): string {
  let max = BigInt(0)
  for (const key of existing) {
    const parsed = safeOrderKeyInt(key)
    if (parsed !== undefined && parsed > max) max = parsed
  }
  return toWorkItemOrderKey(max + BigInt(WORK_ITEM_ORDER_STEP))
}

/**
 * A key strictly between `before` and `after` (either may be undefined for the ends).
 * Throws when the neighbors are adjacent integers — the caller should renumber the
 * column with `renormalizeWorkItemOrderKeys` instead.
 */
export function workItemOrderKeyBetween(before: string | undefined, after: string | undefined): string {
  const lo = before === undefined ? BigInt(0) : requireOrderKeyInt(before, 'before')
  const hi = after === undefined ? lo + BigInt(WORK_ITEM_ORDER_STEP * 2) : requireOrderKeyInt(after, 'after')
  if (hi <= lo) throw new Error(`orderKey range exhausted: ${before} .. ${after}`)
  const mid = (lo + hi) / BigInt(2)
  if (mid === lo || mid === hi) throw new Error(`orderKey range exhausted: ${before} .. ${after}`)
  return toWorkItemOrderKey(mid)
}

/** `count` evenly spaced keys starting at the step size, for renumbering a whole column. */
export function renormalizeWorkItemOrderKeys(count: number): string[] {
  return Array.from({ length: Math.max(0, count) }, (_, index) =>
    toWorkItemOrderKey(BigInt(index + 1) * BigInt(WORK_ITEM_ORDER_STEP)),
  )
}

function safeOrderKeyInt(key: string): bigint | undefined {
  if (!/^\d+$/.test(key)) return undefined
  try {
    return BigInt(key)
  } catch {
    return undefined
  }
}

function requireOrderKeyInt(key: string, name: string): bigint {
  const parsed = safeOrderKeyInt(key)
  if (parsed === undefined) throw new Error(`invalid ${name} orderKey: ${key}`)
  return parsed
}
