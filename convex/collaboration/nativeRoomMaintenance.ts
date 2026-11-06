import { paginationOptsValidator } from 'convex/server'
import { v } from 'convex/values'
import { internalMutation } from '../_generated/server'

export const backfillRoomRecency = internalMutation({
  args: { workspaceId: v.string(), paginationOpts: paginationOptsValidator },
  returns: v.object({ continueCursor: v.string(), isDone: v.boolean() }),
  handler: async (ctx, args) => {
    const page = await ctx.db.query('conversationParticipants')
      .withIndex('by_workspaceId_principalId_status', q => q.eq('workspaceId', args.workspaceId))
      .paginate({ ...args.paginationOpts, numItems: Math.max(1, Math.min(100, args.paginationOpts.numItems)) })
    await Promise.all(page.page.map(async participant => {
      const conversation = await ctx.db.get(participant.conversationId)
      if (conversation && conversation.workspaceId === args.workspaceId) {
        await ctx.db.patch(participant._id, { roomLastModified: conversation.lastModified })
      }
    }))
    return { continueCursor: page.continueCursor, isDone: page.isDone }
  },
})
