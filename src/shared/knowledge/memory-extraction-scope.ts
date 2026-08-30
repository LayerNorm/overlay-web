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
