import type { CachedConversation } from './chat-list-cache'

export type CollaborationChatView = 'dms' | 'channels'

export type SoftChatRoute = {
  conversationId: string | null
  view: string | null
}

/** A browser route is authoritative even when it intentionally has no id. */
export function resolveSoftChatRoute(
  browserRoute: SoftChatRoute | null,
  searchRoute: SoftChatRoute,
): SoftChatRoute {
  return browserRoute ?? searchRoute
}

/**
 * Restores a conversation only when it still belongs to the selected subview.
 * A stale session id must never make a DM render as a channel (or vice versa).
 */
export function selectConversationForView(
  chats: CachedConversation[],
  storedConversationId: string | null,
): CachedConversation | null {
  if (storedConversationId) {
    const stored = chats.find((chat) => chat._id === storedConversationId)
    if (stored) return stored
  }
  return chats[0] ?? null
}
