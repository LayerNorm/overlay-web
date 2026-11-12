/**
 * Identifies the transcript a scroll would mark read. Marking read covers the
 * whole room, so scrolling again over the same transcript has nothing to add.
 */
export function roomScrollReadKey(conversationId: string, messages: ReadonlyArray<{ id: string }>): string {
  return `${conversationId}:${messages.length}:${messages.at(-1)?.id ?? ''}`
}
