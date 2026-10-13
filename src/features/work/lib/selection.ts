import type { WorkItem, WorkStatus } from '@overlay/app-core/work'
import { WORK_STATUSES } from '@/shared/work/status'
export type WorkFilter = 'all' | 'needs-you' | 'assigned'
export function selectWork(
  items: readonly WorkItem[],
  args: { query: string; filter: WorkFilter; userId: string; principalId?: string },
) {
  const query = args.query.trim().toLowerCase()
  return items.filter((item) => {
    if (query && !`${item.title}\n${item.description}`.toLowerCase().includes(query)) return false
    if (args.filter === 'assigned')
      return Boolean(args.principalId && item.assigneePrincipalId === args.principalId)
    if (args.filter === 'needs-you')
      return (
        (item.status === 'review' && item.reviewerUserId === args.userId) ||
        Boolean(item.blocked && args.principalId && item.assigneePrincipalId === args.principalId)
      )
    return true
  })
}
export function groupWork(items: readonly WorkItem[]): { status: WorkStatus; items: WorkItem[] }[] {
  return WORK_STATUSES.map((status) => ({
    status,
    items: items
      .filter((item) => item.status === status)
      .sort((a, b) => (a.rank < b.rank ? -1 : a.rank > b.rank ? 1 : a._id.localeCompare(b._id))),
  }))
}
