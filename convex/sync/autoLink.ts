import { v } from 'convex/values'
import { api } from '../_generated/api'
import { mutation } from '../_generated/server'
import type { Id } from '../_generated/dataModel'
import { validateServerSecret } from '../lib/auth'
import { providerValidator } from './validators'

/**
 * A public channel was created in a connected Slack workspace or Teams team.
 * When the connection has auto-link on, links it to a new Overlay channel
 * through the same rules as a manual link, acting as the person who connected
 * the workspace. Returns null when auto-link is off, the channel is already
 * linked, or the connector can no longer manage sync.
 */
export const channelCreated = mutation({
  args: {
    serverSecret: v.string(),
    provider: providerValidator,
    externalOrgId: v.string(),
    externalChannelId: v.string(),
    externalGroupId: v.optional(v.string()),
    externalChannelName: v.string(),
  },
  returns: v.union(v.null(), v.object({ linkId: v.id('syncChannelLinks'), conversationId: v.id('conversations') })),
  handler: async (ctx, args): Promise<{ linkId: Id<'syncChannelLinks'>; conversationId: Id<'conversations'> } | null> => {
    if (!validateServerSecret(args.serverSecret)) throw new Error('Unauthorized')
    const connections = await ctx.db.query('syncConnections')
      .withIndex('by_provider_externalOrgId', q => q.eq('provider', args.provider).eq('externalOrgId', args.externalOrgId))
      .collect()
    const connection = connections.find(row => row.status === 'connected')
    if (!connection?.autoLink) return null
    try {
      return await ctx.runMutation(api.sync.links.linkChannel, {
        serverSecret: args.serverSecret,
        actorUserId: connection.connectedByUserId,
        workspaceId: connection.workspaceId,
        provider: args.provider,
        externalChannelId: args.externalChannelId,
        ...(args.externalGroupId ? { externalGroupId: args.externalGroupId } : {}),
        externalChannelName: args.externalChannelName,
        externalChannelKind: 'public',
      })
    } catch {
      return null
    }
  },
})
