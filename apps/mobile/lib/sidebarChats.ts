import type { SidebarChat } from '../components/shell/SidebarView'

export function withUnreadActivity(
  chats: SidebarChat[],
  notifications: Array<{ conversationId?: string; readAt?: number }>,
): SidebarChat[] {
  const counts = new Map<string, number>()
  for (const item of notifications) {
    if (item.conversationId && !item.readAt)
      counts.set(item.conversationId, (counts.get(item.conversationId) ?? 0) + 1)
  }
  return chats.map((chat) =>
    chat.kind === 'personal' ? chat : { ...chat, unreadCount: counts.get(chat.id) ?? 0 },
  )
}
