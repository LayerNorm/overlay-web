import type { Doc } from '../_generated/dataModel'
import type { QueryCtx } from '../_generated/server'

type ReadContext = Pick<QueryCtx, 'db'>

/**
 * The one rule for which conversations take the unified public stream. Admission,
 * `appendPublicStream` and the step-checkpoint writer all ask it, so a conversation
 * that receives live text always receives the checkpoint that retires it.
 *
 * Mirrored surfaces (`externalPlatform`, `surfaceBindingId`) stay on the legacy path:
 * their rows are read-only copies of another system's thread. Chat replies are
 * owner-only; room and work replies are authored by the agent principal, which the
 * writers check on the message itself. A conversation the retired automation runner
 * created counts only while an automation is still bound to it.
 */
export async function isPublicStreamConversation(
  ctx: ReadContext,
  input: {
    conversation: Doc<'conversations'> | null
    actorUserId: string
    workspaceId: string | undefined
    mode: Doc<'conversationAgentRuns'>['mode']
  },
): Promise<boolean> {
  const { conversation } = input
  if (!conversation || conversation.deletedAt !== undefined
    || conversation.externalPlatform !== undefined || conversation.surfaceBindingId !== undefined
    || !conversation.workspaceId || conversation.workspaceId !== input.workspaceId) return false
  if (input.mode === 'room' || input.mode === 'work') return true
  if (conversation.userId !== input.actorUserId) return false
  if (!conversation.isAutomation) return true
  const automation = await ctx.db.query('automations')
    .withIndex('by_conversationId_deletedAt', q => q.eq('conversationId', conversation._id).eq('deletedAt', undefined))
    .first()
  return automation !== null
}
