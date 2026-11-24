import type { MutationCtx, QueryCtx } from '../_generated/server'
import { isSharedRoom } from '../../src/shared/agents/room-access'

/**
 * Whether people other than the asker can read this conversation (`isSharedRoom`): an external surface (Slack), a
 * channel, or a room with more than one active person. What an agent learns there is workspace context.
 */
export async function conversationAudienceIsShared(ctx: MutationCtx | QueryCtx, conversationId: string): Promise<boolean> {
  const id = ctx.db.normalizeId('conversations', conversationId)
  const conversation = id ? await ctx.db.get(id) : null
  if (!conversation || conversation.deletedAt !== undefined) throw new Error('CONVERSATION_ACCESS_DENIED')
  if (conversation.externalPlatform !== undefined || conversation.surfaceBindingId !== undefined) return true
  if (conversation.origin?.kind === 'channel') return true
  const participants = await ctx.db.query('conversationParticipants')
    .withIndex('by_conversationId_principalId', q => q.eq('conversationId', conversation._id))
    .collect()
  return isSharedRoom({
    conversationType: conversation.conversationType ?? 'personal',
    channelVisibility: conversation.channelVisibility,
    humanParticipants: participants.filter(participant => participant.status === 'active'
      && participant.principalType === 'human').length,
  })
}
