import { v } from 'convex/values'
import { canManageWorkspace } from '@overlay/workspace-contracts'
import { query } from '../_generated/server'
import { requireNativeWorkspace } from '../lib/nativeViewer'

export const forWorkspace = query({
  args: { workspaceId: v.string() },
  handler: async (ctx, { workspaceId }) => {
    let viewer
    try {
      viewer = await requireNativeWorkspace(ctx, workspaceId)
    } catch {
      return null
    }
    const connections = await ctx.db.query('surfaceConnections').withIndex('by_workspaceId', q => q.eq('workspaceId', workspaceId)).collect()
    const agents = await ctx.db.query('workspaceAgentDefinitions').withIndex('by_workspaceId', q => q.eq('workspaceId', workspaceId)).collect()
    const chiefs = agents.filter(agent => agent.agentRole === 'workspace_chief' && agent.harness === 'overlay'
      && agent.archivedAt === undefined && agent.deletedAt === undefined)
    const connectionIds = new Set(connections.map(connection => connection.id))
    const bindings = (await Promise.all(chiefs.map(chief => ctx.db.query('surfaceBindings')
      .withIndex('by_agentId', q => q.eq('agentId', chief.agentId)).collect()))).flat()
      .filter(binding => connectionIds.has(binding.connectionId) && binding.status === 'active')
    const ownLinks = (await Promise.all(connections.map(connection => ctx.db.query('slackIdentityLinks')
      .withIndex('by_overlay_identity', q => q.eq('teamId', connection.externalTeamId).eq('userId', viewer.userId)).collect()))).flat()
      .filter(link => link.workspaceId === workspaceId && connectionIds.has(link.connectionId) && link.status === 'active')
    return {
      connections: connections.map(connection => ({
        id: connection.id, workspaceId: connection.workspaceId, platform: connection.platform,
        externalTeamId: connection.externalTeamId, externalTeamName: connection.externalTeamName ?? null,
        externalEnterpriseId: connection.externalEnterpriseId ?? null, botUserId: connection.botUserId ?? null,
        status: connection.status, installedByUserId: connection.installedByUserId,
        createdAt: connection.createdAt, updatedAt: connection.updatedAt,
      })),
      bindings: bindings.map(binding => ({
        id: binding.id, connectionId: binding.connectionId, agentId: binding.agentId,
        channelId: binding.channelId, channelName: binding.channelName ?? null, status: binding.status,
        createdByUserId: binding.createdByUserId, createdAt: binding.createdAt, updatedAt: binding.updatedAt,
      })),
      canManage: canManageWorkspace(viewer.membership.role),
      identityLinks: ownLinks.map(link => ({ id: link.id, connectionId: link.connectionId, slackUserId: link.slackUserId,
        ...(link.displayName ? { displayName: link.displayName } : {}) })),
    }
  },
})
