import type { ChatListConversation } from './chat-list-conversation'
import { buildWorkspaceHref, resolveWorkspaceSurface } from '../workspaces/routing'

export function agentConversationRedirect(args: { pathname: string; workspaceId: string | null; agentId?: string; conversationId: string; guided: boolean;  }) {
  if (args.guided || !args.workspaceId || !args.agentId || resolveWorkspaceSurface(args.pathname) !== 'chat') return null
  return `${buildWorkspaceHref(args.workspaceId, '/app/agents')}?${new URLSearchParams({ agent: args.agentId, id: args.conversationId })}`
}


export function isTransientConversationDraft(conversationType: 'dm' | 'channel', draft: boolean): boolean {
  // Channels are durable as soon as they are created, even without messages.
  return conversationType === 'dm' && draft
}

export function scopeForConversationDetail(conversation: {
  conversationType?: 'personal' | 'dm' | 'channel'
  scope?: 'personal' | 'workspace'
}): 'personal' | 'workspace' {
  if (conversation.conversationType === 'dm' || conversation.conversationType === 'channel') {
    return 'workspace'
  }
  return conversation.scope === 'workspace' ? 'workspace' : 'personal'
}

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
  chats: ChatListConversation[],
  storedConversationId: string | null,
): ChatListConversation | null {
  if (storedConversationId) {
    const stored = chats.find((chat) => chat._id === storedConversationId)
    if (stored) return stored
  }
  return chats[0] ?? null
}
