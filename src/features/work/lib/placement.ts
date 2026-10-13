import type { WorkItem, WorkStatus } from '@overlay/app-core/work'
export function workPlacement(items: readonly WorkItem[], moving: WorkItem, status: WorkStatus, beforeCardId?: string) {
  const column = items.filter((row) => row._id !== moving._id && row.scope === moving.scope && row.status === status && (row.scope === 'workspace' || row.userId === moving.userId)).sort((a, b) => a.rank.localeCompare(b.rank) || a._id.localeCompare(b._id))
  const target = beforeCardId ? column.findIndex((row) => row._id === beforeCardId) : column.length
  if (target < 0) throw new Error('Choose a task in the same scope')
  return { status, beforeId: column[target - 1]?._id, afterId: column[target]?._id }
}
