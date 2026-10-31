const PENDING_COLLABORATION_MESSAGE_KEY = 'overlay:pending-collaboration-message'
const PENDING_COLLABORATION_MESSAGE_TTL_MS = 60_000

export type PendingCollaborationMessage = {
  conversationId: string
  content: string
  expectedAgentPrincipalId?: string
  savedAt: number
}

/**
 * Carries a confirmed Personal-chat draft across the one route change that opens
 * its new DM or channel. It is intentionally session-scoped and consumed once.
 */
export function savePendingCollaborationMessage(
  message: Omit<PendingCollaborationMessage, 'savedAt'>,
  now = Date.now(),
): void {
  if (typeof window === 'undefined') return
  // Safari private browsing and hardened enterprise browsers may deny storage.
  // Failing here must not break the newly created conversation route.
  try {
    window.sessionStorage.setItem(
      PENDING_COLLABORATION_MESSAGE_KEY,
      JSON.stringify({ ...message, savedAt: now }),
    )
  } catch {
    // The user can still continue in the new conversation; only draft carry-over is unavailable.
  }
}

export function restorePendingCollaborationMessage(message: PendingCollaborationMessage): void {
  if (typeof window === 'undefined') return
  try {
    const current = window.sessionStorage.getItem(PENDING_COLLABORATION_MESSAGE_KEY)
    if (current) {
      const parsed = JSON.parse(current) as Partial<PendingCollaborationMessage>
      if (
        parsed.conversationId !== message.conversationId
        || parsed.content !== message.content
        || parsed.savedAt !== message.savedAt
      ) return
      return
    }
    window.sessionStorage.setItem(PENDING_COLLABORATION_MESSAGE_KEY, JSON.stringify(message))
  } catch {
    // A newer or inaccessible session draft must not be replaced.
  }
}

export function takePendingCollaborationMessage(
  conversationId: string,
  canConsume?: (message: PendingCollaborationMessage) => boolean,
  now = Date.now(),
): PendingCollaborationMessage | null {
  if (typeof window === 'undefined') return null
  try {
    const serialized = window.sessionStorage.getItem(PENDING_COLLABORATION_MESSAGE_KEY)
    if (!serialized) return null
    let parsed: Partial<PendingCollaborationMessage>
    try {
      parsed = JSON.parse(serialized) as Partial<PendingCollaborationMessage>
    } catch {
      window.sessionStorage.removeItem(PENDING_COLLABORATION_MESSAGE_KEY)
      return null
    }
    if (
      typeof parsed.conversationId !== 'string'
      || typeof parsed.content !== 'string'
      || !parsed.content.trim()
      || typeof parsed.savedAt !== 'number'
      || !Number.isFinite(parsed.savedAt)
      || parsed.savedAt < 0
      || parsed.savedAt > now
      || now - parsed.savedAt > PENDING_COLLABORATION_MESSAGE_TTL_MS
    ) {
      window.sessionStorage.removeItem(PENDING_COLLABORATION_MESSAGE_KEY)
      return null
    }
    const message: PendingCollaborationMessage = {
      conversationId: parsed.conversationId,
      content: parsed.content,
      savedAt: parsed.savedAt,
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
