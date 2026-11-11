import type {
  WorkspaceNotification,
  WorkspaceNotificationFilter,
} from '@overlay/workspace-contracts'

export function filterNotifications(
  items: WorkspaceNotification[],
  filter: WorkspaceNotificationFilter,
  options: { unreadOnly?: boolean; limit?: number } = {},
) {
  return items
    .filter((item) => {
      if ((options.unreadOnly || filter === 'unread') && item.readAt) return false
      if (filter === 'mentions') return item.type === 'mention'
      if (filter === 'threads') return item.type === 'thread'
      if (filter === 'reactions') return item.type === 'reaction'
      return true
    })
    .slice(0, options.limit ?? 100)
}
