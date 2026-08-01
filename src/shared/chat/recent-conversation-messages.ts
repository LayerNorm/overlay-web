export type RecentConversationMessageCandidate = {
  _id: string
  turnId?: string
  role: 'user' | 'assistant'
  authorKind?: 'human' | 'agent' | 'model' | 'system'
  clientNonce?: string
  createdAt: number
}

/**
 * Selects the latest human turns while retaining workspace-agent replies.
 *
 * Personal-chat assistants share the user's turn id. Workspace agents use an
 * idempotency nonce tied to the persisted human message instead, so selecting
 * solely by turn id hides their otherwise-successful responses.
 */
export function selectRecentConversationMessages<
  T extends RecentConversationMessageCandidate,
>(recentScan: readonly T[], limit: number): T[] {
  const selectedTurnIds: string[] = []
  for (const message of recentScan) {
    if (message.role !== 'user') continue
    const turnId = message.turnId?.trim() || message._id
    if (selectedTurnIds.includes(turnId)) continue
    selectedTurnIds.push(turnId)
    if (selectedTurnIds.length >= limit) break
  }

  const selectedTurnIdSet = new Set(selectedTurnIds)
  const selectedHumanMessageIds = recentScan
    .filter((message) => (
      message.role === 'user'
      && selectedTurnIdSet.has(message.turnId?.trim() || message._id)
    ))
    .map((message) => message._id)

  return recentScan
    .filter((message) => (
      selectedTurnIdSet.has(message.turnId?.trim() || message._id)
      || (
        message.authorKind === 'agent'
        && selectedHumanMessageIds.some((messageId) => (
          message.clientNonce?.startsWith(`agent:${messageId}:`)
        ))
      )
    ))
    .sort((a, b) => a.createdAt - b.createdAt)
}
