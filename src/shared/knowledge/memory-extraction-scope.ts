export type MemoryExtractionAuthor = {
  authorKind?: string | null
  authorPrincipalId?: string | null
  userId: string
}

/**
 * Memory extraction may use prior messages from the target author, but must
 * never disclose another room participant's messages to the extraction model.
 */
export function hasSameMemoryExtractionAuthor(
  message: MemoryExtractionAuthor,
  target: MemoryExtractionAuthor,
): boolean {
  if (target.authorKind === 'agent') {
    return Boolean(target.authorPrincipalId)
      && message.authorKind === 'agent'
      && message.authorPrincipalId === target.authorPrincipalId
  }
  if (target.authorKind === 'human' || !target.authorKind) {
    return message.authorKind !== 'agent'
      && message.userId === target.userId
  }
  return false
}

/**
 * The input must be in newest-first database order. Selecting by position,
 * instead of a millisecond timestamp, makes equal-timestamp rows unambiguous.
 */
export function selectMessagesAtOrBeforeTarget<T>(
  messagesNewestFirst: readonly T[],
  target: T,
  isTarget: (message: T) => boolean,
): T[] {
  const targetIndex = messagesNewestFirst.findIndex(isTarget)
  return targetIndex >= 0
    ? messagesNewestFirst.slice(targetIndex)
    : [target]
}
