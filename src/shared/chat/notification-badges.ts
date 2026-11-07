export type ConversationNotification = {
  conversationType?: 'personal' | 'dm' | 'channel'
}

export type CollaborationUnreadCounts = {
  dms: number
  channels: number
  total: number
}

/**
 * Splits unread collaboration notifications into the DM and channel subviews by the room type each notification
 * carries. `total` includes every notification, so Activity stays complete.
 */
export function categorizeCollaborationUnreadNotifications(
  notifications: readonly ConversationNotification[],
): CollaborationUnreadCounts {
  let dms = 0
  let channels = 0
  for (const notification of notifications) {
    if (notification.conversationType === 'dm') dms += 1
    else if (notification.conversationType === 'channel') channels += 1
  }
  return { dms, channels, total: notifications.length }
}
