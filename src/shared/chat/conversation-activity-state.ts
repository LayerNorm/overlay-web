export type ConversationActivityState = 'archived' | 'deleted'

export function resolveConversationActivityState(args: {
  archivedAt?: number | null
  conversation: { deletedAt?: number | null } | null | undefined
}): ConversationActivityState | undefined {
  if (!args.conversation || args.conversation.deletedAt) return 'deleted'
  if (args.archivedAt) return 'archived'
  return undefined
}

export function conversationActivityLabel(
  state: ConversationActivityState | undefined,
): string | undefined {
  if (state === 'deleted') return 'Deleted chat'
  if (state === 'archived') return 'Archived chat'
  return undefined
}
