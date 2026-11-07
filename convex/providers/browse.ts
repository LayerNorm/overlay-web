import { v } from 'convex/values'
import { query } from '../_generated/server'
import type { Doc } from '../_generated/dataModel'
import { requireNativeWorkspace } from '../lib/nativeViewer'
import { requireNativeDeploymentFeature } from '../lib/nativeDeploymentPolicy'
import { stripSecrets } from './connections'

/**
 * The model-provider connections a member may use in a workspace, live: their own personal connections plus
 * subscription connections shared with the workspace (manageable only by their owner). Vault references never leave
 * the server. Null without access or when model routing is off.
 */
export const connections = query({
  args: { workspaceId: v.string() },
  handler: async (ctx, { workspaceId }) => {
    let userId: string
    try {
      userId = (await requireNativeWorkspace(ctx, workspaceId)).userId
      await requireNativeDeploymentFeature(ctx, 'modelRouting')
    } catch {
      return null
    }
    const owned = await ctx.db.query('userProviderConnections').withIndex('by_userId', q => q.eq('userId', userId)).collect()
    const shared = await ctx.db.query('userProviderConnections')
      .withIndex('by_workspaceId_scope', q => q.eq('workspaceId', workspaceId).eq('scope', 'workspace')).collect()
    const byId = new Map<string, Doc<'userProviderConnections'>>()
    for (const row of shared) if (row.authKind === 'subscription' && row.subscriptionProvider) byId.set(row._id, row)
    for (const row of owned) if ((row.scope ?? 'personal') === 'personal') byId.set(row._id, row)
    return [...byId.values()]
      .map(row => stripSecrets(row, row.userId === userId))
      .sort((a, b) => (a.isDefault !== b.isDefault ? (a.isDefault ? -1 : 1) : a.displayName.localeCompare(b.displayName)))
  },
})
