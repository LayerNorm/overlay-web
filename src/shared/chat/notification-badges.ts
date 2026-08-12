export type NotificationConversation = {
  _id: string
  conversationType?: 'personal' | 'dm' | 'channel'
}

export type ConversationNotification = {
  conversationId?: string
}

export type CollaborationUnreadCounts = {
  dms: number
  channels: number
  total: number
}

/**
 * A collaboration notification only identifies its conversation. Resolve that
 * id against the current workspace conversation directory before assigning it
 * to a Chats subview. `total` deliberately includes notifications whose room
 * is no longer present in the first page so Activity remains complete.
 */
export function categorizeCollaborationUnreadNotifications(
  notifications: readonly ConversationNotification[],
  conversations: readonly NotificationConversation[],
): CollaborationUnreadCounts {
  const conversationTypes = new Map(conversations.map((conversation) => [
    conversation._id,
    conversation.conversationType,
  ]))
  let dms = 0
  let channels = 0

  for (const notification of notifications) {
    const conversationType = notification.conversationId
      ? conversationTypes.get(notification.conversationId)
      : undefined
    if (conversationType === 'dm') dms += 1
    else if (conversationType === 'channel') channels += 1
  }

  return { dms, channels, total: notifications.length }
}
