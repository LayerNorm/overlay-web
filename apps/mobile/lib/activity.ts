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

/** One-paragraph plain-text preview of a markdown message body. */
export function activityPreview(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}(#{1,6}\s+|>\s?|[-*+]\s+|\d+[.)]\s+)/gm, '')
    .replace(/(\*\*|__|~~|`)/g, '')
    .replace(/(^|\s)[*_](\S[^*_]*\S|\S)[*_](?=\s|$|[.,!?;:])/g, '$1$2')
    .replace(/\s+/g, ' ')
    .trim()
}
