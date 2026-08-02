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
