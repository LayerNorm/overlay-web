import { v } from 'convex/values'
import { query } from '../_generated/server'
import { requireNativeWorkspace } from '../lib/nativeViewer'

const MAX_ROWS = 500

/**
 * The channels and direct messages the viewer archived in this workspace, live (archiving is per person). Names and
 * types only; messages load when a room opens. Null without workspace access.
 */
export const rooms = query({
  // `include` adds one archived room by id, so a link to a room older than the newest MAX_ROWS still opens it.
  args: { workspaceId: v.string(), include: v.optional(v.id('conversations')) },
  handler: async (ctx, { workspaceId, include }) => {
    let viewer
    try {
      viewer = await requireNativeWorkspace(ctx, workspaceId)
    } catch {
      return null
    }
    const participants = await ctx.db.query('conversationParticipants')
      .withIndex('by_workspaceId_principalId_status_archivedAt', q =>
        q.eq('workspaceId', workspaceId).eq('principalId', viewer.principal.principalId).eq('status', 'active').gt('archivedAt', 0))
      .order('desc').take(MAX_ROWS)
    if (include && !participants.some(participant => participant.conversationId === include)) {
      const extra = await ctx.db.query('conversationParticipants')
        .withIndex('by_conversationId_principalId', q => q.eq('conversationId', include).eq('principalId', viewer.principal.principalId))
        .unique()
      if (extra && extra.workspaceId === workspaceId && extra.status === 'active' && extra.archivedAt !== undefined) participants.push(extra)
    }
    const rows = await Promise.all(participants.map(async participant => {
      const conversation = await ctx.db.get(participant.conversationId)
      const type = conversation?.conversationType
      // Agent threads are DMs underneath but are listed (and restored) with their agent.
      if (!conversation || conversation.deletedAt !== undefined || conversation.workspaceId !== workspaceId || conversation.agentId
        || (type !== 'channel' && type !== 'dm')) return null
      return {
        _id: conversation._id,
        title: conversation.title,
        conversationType: type,
        scope: conversation.scope ?? 'workspace',
        workspaceId,
        archivedAt: participant.archivedAt,
      }
    }))
    return rows.filter(row => row !== null).sort((a, b) => (b.archivedAt ?? 0) - (a.archivedAt ?? 0))
  },
})
