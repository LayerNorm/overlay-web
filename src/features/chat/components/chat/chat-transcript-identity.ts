export type TranscriptIdentity = {
  conversationId: string | null
  firstTurnId: string | null
  key: number
}

export function reconcileTranscriptIdentity(
  previous: TranscriptIdentity,
  conversationId: string | null,
  firstTurnId: string | null,
): TranscriptIdentity {
  if (previous.conversationId === conversationId && previous.firstTurnId === firstTurnId) return previous

  // A first send is saved after streaming; its assigned conversation ID is not navigation.
  const savedFirstSend = previous.conversationId === null && conversationId !== null &&
    firstTurnId !== null && previous.firstTurnId === firstTurnId
  const reset = previous.conversationId !== conversationId && !savedFirstSend
  return { conversationId, firstTurnId, key: previous.key + (reset ? 1 : 0) }
}
