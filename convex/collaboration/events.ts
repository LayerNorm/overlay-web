import type { MutationCtx } from '../_generated/server'
import type { Id } from '../_generated/dataModel'

/** Append one durable collaboration event behind the provider-neutral contract. */
export async function recordConversationEvent(
  ctx: Pick<MutationCtx, 'db'>,
  args: {
    conversationId: Id<'conversations'>
    workspaceId?: string
    userId: string
    type: string
    messageId?: Id<'conversationMessages'>
    payload?: Record<string, unknown>
  },
): Promise<void> {
  const conversation = await ctx.db.get(args.conversationId)
  if (['message.created', 'conversation.created', 'participant.added'].includes(args.type)
    && conversation && conversation.conversationType && conversation.conversationType !== 'personal') {
    const participants = await ctx.db.query('conversationParticipants')
      .withIndex('by_conversationId_status', q => q.eq('conversationId', args.conversationId).eq('status', 'active')).collect()
    await Promise.all(participants.filter(p => p.roomLastModified !== conversation.lastModified)
      .map(p => ctx.db.patch(p._id, { roomLastModified: conversation.lastModified })))
  }
  await ctx.db.insert('conversationEvents', {
    conversationId: args.conversationId,
    workspaceId: args.workspaceId,
    userId: args.userId,
    type: args.type,
    messageId: args.messageId,
    payload: args.payload,
    createdAt: Date.now(),
  })
}
