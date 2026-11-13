import { v } from 'convex/values'
import { query } from '../_generated/server'
import type { Id } from '../_generated/dataModel'
import { requireNativeWorkspace } from '../lib/nativeViewer'

/**
 * Linked channels the viewer can see, with their source, for the small Slack or
 * Teams label in the Chats list and channel header. Private channels are only
 * listed for their members.
 */
export const channelSources = query({
  args: { workspaceId: v.string() },
  handler: async (ctx, { workspaceId }) => {
    let viewer
    try {
      viewer = await requireNativeWorkspace(ctx, workspaceId)
    } catch {
      return null
    }
    const links = await ctx.db.query('syncChannelLinks')
      .withIndex('by_workspaceId_provider', q => q.eq('workspaceId', workspaceId))
      .collect()
    const sources: Array<{ conversationId: Id<'conversations'>; provider: 'slack' | 'teams'; importing: boolean }> = []
    for (const link of links) {
      const conversation = await ctx.db.get(link.conversationId)
      if (!conversation || conversation.deletedAt !== undefined) continue
      if (conversation.channelVisibility !== 'public') {
        const participant = await ctx.db.query('conversationParticipants')
          .withIndex('by_conversationId_principalId', q => q.eq('conversationId', link.conversationId).eq('principalId', viewer.principal.principalId))
          .first()
        if (participant?.status !== 'active') continue
      }
      sources.push({ conversationId: link.conversationId, provider: link.provider, importing: link.status === 'history' })
    }
    return sources
  },
})

/** Overlay channels the viewer belongs to that can receive a sync link: native, not deleted and not linked yet. */
export const linkTargets = query({
  args: { workspaceId: v.string() },
  handler: async (ctx, { workspaceId }) => {
    let viewer
    try {
      viewer = await requireNativeWorkspace(ctx, workspaceId)
    } catch {
      return null
    }
    const participations = await ctx.db.query('conversationParticipants')
      .withIndex('by_workspaceId_principalId_status', q => q.eq('workspaceId', workspaceId).eq('principalId', viewer.principal.principalId).eq('status', 'active'))
      .take(500)
    const targets: Array<{ conversationId: Id<'conversations'>; name: string; visibility: 'public' | 'private' }> = []
    for (const participation of participations) {
      const conversation = await ctx.db.get(participation.conversationId)
      if (!conversation || conversation.deletedAt !== undefined || conversation.conversationType !== 'channel' || conversation.externalPlatform) continue
      const linked = await ctx.db.query('syncChannelLinks').withIndex('by_conversationId', q => q.eq('conversationId', conversation._id)).first()
      if (linked) continue
      targets.push({
        conversationId: conversation._id,
        name: conversation.channelSlug ?? conversation.title,
        visibility: conversation.channelVisibility === 'public' ? 'public' : 'private',
      })
    }
    return targets.sort((a, b) => a.name.localeCompare(b.name))
  },
})
