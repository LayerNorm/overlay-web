import type { QueryCtx } from '../_generated/server'

// These events change sidebar rows. Text deltas belong to the active transcript
// subscription; subscribing the sidebar to them causes an HTTP read per chunk.
const listEventTypes = [
  'conversation.created', 'conversation.updated', 'conversation.deleted',
  'message.created', 'message.completed', 'message.failed',
] as const

/** Indexed semantic events keep the version stable even across a long stream. */
export async function conversationListVersion(
  ctx: Pick<QueryCtx, 'db'>,
  scope: { workspaceId: string } | { userId: string },
): Promise<number> {
  const latest = await Promise.all(listEventTypes.map(type => (
    'workspaceId' in scope
      ? ctx.db.query('conversationEvents')
        .withIndex('by_workspaceId_type', q => q.eq('workspaceId', scope.workspaceId).eq('type', type))
        .order('desc').first()
      : ctx.db.query('conversationEvents')
        .withIndex('by_userId_type', q => q.eq('userId', scope.userId).eq('type', type))
        .order('desc').first()
  )))
  return Math.max(0, ...latest.map(event => event?._creationTime ?? 0))
}
