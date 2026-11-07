import { v } from 'convex/values'
import { query } from '../_generated/server'
import { requireNativeWorkspace } from '../lib/nativeViewer'
import { otherParticipantTypes } from './directMessages'

/** Upper bound on one person's active room memberships read per call; far above any real sidebar. */
const MAX_PARTICIPATIONS = 5000
const DEFAULT_PAGE = 50
const MAX_PAGE = 500

/**
 * The channels and direct messages the viewer takes part in and has not archived, newest activity first, live: a new
 * message, a rename, a new room, joining, leaving or archiving updates every sidebar at once. Agent threads and
 * automation chats are excluded (they live under their agent); personal AI chats come from the personal chat list.
 * Every membership is read and sorted before the page is cut, so a newly active room is never crowded out; `limit`
 * grows as the sidebar asks for more, and `hasMore` says whether older rooms remain. Null without workspace access.
 */
export const list = query({
  args: {
    workspaceId: v.string(),
    kind: v.union(v.literal('dm'), v.literal('channel'), v.literal('all')),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { workspaceId, kind, limit }) => {
    const pageSize = Math.max(1, Math.min(MAX_PAGE, Math.floor(limit ?? DEFAULT_PAGE)))
    let viewer
    try {
      viewer = await requireNativeWorkspace(ctx, workspaceId)
    } catch {
      return null
    }
    const participations = await ctx.db.query('conversationParticipants')
      .withIndex('by_workspaceId_principalId_status_archivedAt', q =>
        q.eq('workspaceId', workspaceId).eq('principalId', viewer.principal.principalId).eq('status', 'active').eq('archivedAt', undefined))
      .take(MAX_PARTICIPATIONS)
    const conversations = await Promise.all(participations.map(row => ctx.db.get(row.conversationId)))
    const rooms = conversations
      .filter(conversation => conversation !== null)
      .filter(conversation => {
        const type = conversation.conversationType
        return conversation.workspaceId === workspaceId && !conversation.deletedAt && !conversation.isAutomation && !conversation.agentId
          && (type === 'dm' || type === 'channel') && (kind === 'all' || type === kind)
      })
      .sort((left, right) => right.lastModified - left.lastModified)
    const page = await Promise.all(rooms.slice(0, pageSize).map(async conversation => ({
      _id: conversation._id,
      title: conversation.title,
      lastModified: conversation.lastModified,
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt ?? conversation.lastModified,
      conversationType: conversation.conversationType as 'dm' | 'channel',
      scope: conversation.scope,
      workspaceId,
      otherParticipantTypes: await otherParticipantTypes(ctx, conversation._id, viewer.principal.principalId),
      ...(conversation.externalPlatform ? { externalPlatform: conversation.externalPlatform } : {}),
    })))
    return { rooms: page, hasMore: rooms.length > pageSize }
  },
})
