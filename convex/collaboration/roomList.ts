import { v } from 'convex/values'
import { query } from '../_generated/server'
import { requireNativeWorkspace } from '../lib/nativeViewer'
import { otherParticipantTypes } from './directMessages'

const MAX_PARTICIPATIONS = 1000
const MAX_ROOMS = 200

/**
 * The channels and direct messages the viewer takes part in and has not archived, newest activity first, live: a new
 * message, a rename, a new room, joining, leaving or archiving updates every sidebar at once. Agent threads and
 * automation chats are excluded (they live under their agent); personal AI chats come from the personal chat list.
 * Null without workspace access.
 */
export const list = query({
  args: { workspaceId: v.string(), kind: v.union(v.literal('dm'), v.literal('channel'), v.literal('all')) },
  handler: async (ctx, { workspaceId, kind }) => {
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
      .slice(0, MAX_ROOMS)
    return await Promise.all(rooms.map(async conversation => ({
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
  },
})
