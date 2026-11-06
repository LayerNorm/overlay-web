import { paginationOptsValidator } from 'convex/server'
import { v } from 'convex/values'
import { internalMutation } from '../_generated/server'
import { internal } from '../_generated/api'
import { NATIVE_ROOM_RECENCY_MIGRATION } from './nativeCollaborationReadiness'
import { drainRoomRecencyFanout } from './roomRecencyFanout'

export const kickRoomRecencyBackfill = internalMutation({
  args: {}, returns: v.null(),
  handler: async ctx => {
    await drainRoomRecencyFanout(ctx)
    const state = await ctx.db.query('migrationMarkers')
      .withIndex('by_key_scope', q => q.eq('key', NATIVE_ROOM_RECENCY_MIGRATION).eq('scope', 'global')).unique()
    if (state && (state.completedAt > 0 || (state.scheduledAt !== undefined && state.scheduledAt > Date.now() - 120_000))) return null
    if (state) await ctx.db.patch(state._id, { scheduledAt: Date.now() })
    else await ctx.db.insert('migrationMarkers', { key: NATIVE_ROOM_RECENCY_MIGRATION, scope: 'global', completedAt: 0, scheduledAt: Date.now() })
    await ctx.scheduler.runAfter(0, internal.collaboration.nativeRoomMaintenance.runRoomRecencyBackfill, {})
    return null
  },
})

export const runRoomRecencyBackfill = internalMutation({
  args: {}, returns: v.null(),
  handler: async ctx => {
    const state = await ctx.db.query('migrationMarkers')
      .withIndex('by_key_scope', q => q.eq('key', NATIVE_ROOM_RECENCY_MIGRATION).eq('scope', 'global')).unique()
    if (!state || state.completedAt > 0) return null
    const page = await ctx.db.query('conversationParticipants').paginate({ numItems: 100, cursor: state.cursor ?? null })
    await Promise.all(page.page.map(async participant => {
      const conversation = await ctx.db.get(participant.conversationId)
      if (conversation && conversation.workspaceId === participant.workspaceId) {
        await ctx.db.patch(participant._id, { roomLastModified: conversation.lastModified })
      }
    }))
    await ctx.db.patch(state._id, { cursor: page.continueCursor, completedAt: page.isDone ? Date.now() : 0, scheduledAt: Date.now() })
    if (!page.isDone) await ctx.scheduler.runAfter(0, internal.collaboration.nativeRoomMaintenance.runRoomRecencyBackfill, {})
    return null
  },
})

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
