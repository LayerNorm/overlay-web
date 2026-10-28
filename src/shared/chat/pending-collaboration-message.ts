const PENDING_COLLABORATION_MESSAGE_KEY = 'overlay:pending-collaboration-message'

export type PendingCollaborationMessage = {
  conversationId: string
  content: string
  expectedAgentPrincipalId?: string
}

/**
 * Carries a confirmed Personal-chat draft across the one route change that opens
 * its new DM or channel. It is intentionally session-scoped and consumed once.
 */
export function savePendingCollaborationMessage(message: PendingCollaborationMessage): void {
  if (typeof window === 'undefined') return
  // Safari private browsing and hardened enterprise browsers may deny storage.
  // Failing here must not break the newly created conversation route.
  try {
    window.sessionStorage.setItem(PENDING_COLLABORATION_MESSAGE_KEY, JSON.stringify(message))
  } catch {
    // The user can still continue in the new conversation; only draft carry-over is unavailable.
  }
}

export function takePendingCollaborationMessage(
  conversationId: string,
  canConsume?: (message: PendingCollaborationMessage) => boolean,
): PendingCollaborationMessage | null {
  if (typeof window === 'undefined') return null
  try {
    const serialized = window.sessionStorage.getItem(PENDING_COLLABORATION_MESSAGE_KEY)
    if (!serialized) return null
    const parsed = JSON.parse(serialized) as Partial<PendingCollaborationMessage>
    if (typeof parsed.conversationId !== 'string' || typeof parsed.content !== 'string' || !parsed.content.trim()) {
      window.sessionStorage.removeItem(PENDING_COLLABORATION_MESSAGE_KEY)
      return null
    }
    const message: PendingCollaborationMessage = {
      conversationId: parsed.conversationId,
      content: parsed.content,
      ...(typeof parsed.expectedAgentPrincipalId === 'string'
        ? { expectedAgentPrincipalId: parsed.expectedAgentPrincipalId }
        : {}),
    }
    if (message.conversationId !== conversationId || (canConsume && !canConsume(message))) return null
    window.sessionStorage.removeItem(PENDING_COLLABORATION_MESSAGE_KEY)
    return message
  } catch {
    return null
  }
}
