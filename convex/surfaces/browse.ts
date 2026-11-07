import { v } from 'convex/values'
import { query } from '../_generated/server'
import { requireNativeWorkspace } from '../lib/nativeViewer'
import { canSee } from '../agents/directory'

/**
 * An agent's surface connections and channel bindings, live, as the server's surface rules allow: the agent must be
 * visible and not archived; bindings are scoped to the workspace's connections; `canBind` is false for guests and,
 * on a creator-only agent, for everyone but its creator. Bot tokens live elsewhere and never appear here.
 */
export const forAgent = query({
  args: { workspaceId: v.string(), agentId: v.string() },
  handler: async (ctx, { workspaceId, agentId }) => {
    let viewer
    try {
      viewer = await requireNativeWorkspace(ctx, workspaceId)
    } catch {
      return null
    }
    const agent = await ctx.db.query('workspaceAgentDefinitions').withIndex('by_agentId', q => q.eq('agentId', agentId)).unique()
    if (!agent || agent.workspaceId !== workspaceId || agent.archivedAt !== undefined || agent.deletedAt !== undefined || !canSee(agent, viewer)) return null
    const connections = await ctx.db.query('surfaceConnections').withIndex('by_workspaceId', q => q.eq('workspaceId', workspaceId)).collect()
    const connectionIds = new Set(connections.map(connection => connection.id))
    const bindings = (await ctx.db.query('surfaceBindings').withIndex('by_agentId', q => q.eq('agentId', agentId)).collect())
      .filter(binding => connectionIds.has(binding.connectionId))
    const role = viewer.membership.role
    const canBind = role !== 'guest' && (agent.visibility !== 'creator' || agent.createdByPrincipalId === viewer.principal.principalId)
    return {
      connections: connections.map(connection => ({
        id: connection.id,
        workspaceId: connection.workspaceId,
        platform: connection.platform,
        externalTeamId: connection.externalTeamId,
        externalTeamName: connection.externalTeamName ?? null,
        externalEnterpriseId: connection.externalEnterpriseId ?? null,
        botUserId: connection.botUserId ?? null,
        status: connection.status,
        installedByUserId: connection.installedByUserId,
        createdAt: connection.createdAt,
        updatedAt: connection.updatedAt,
      })),
      bindings: bindings.map(binding => ({
        id: binding.id,
        connectionId: binding.connectionId,
        agentId: binding.agentId,
        channelId: binding.channelId,
        channelName: binding.channelName ?? null,
        status: binding.status,
        createdByUserId: binding.createdByUserId,
        createdAt: binding.createdAt,
        updatedAt: binding.updatedAt,
      })),
      canBind,
    }
  },
})
