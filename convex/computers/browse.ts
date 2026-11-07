import { v } from 'convex/values'
import { query } from '../_generated/server'
import type { Doc } from '../_generated/dataModel'
import { requireNativeWorkspace } from '../lib/nativeViewer'
import { requireNativeDeploymentFeature } from '../lib/nativeDeploymentPolicy'

type Viewer = Awaited<ReturnType<typeof requireNativeWorkspace>>

/**
 * The Computers a member may see in a workspace, live, so the sidebar, agent panel and settings agree without
 * polling. Rules match the server: personal computers are owner-only; computers of workspace-visible agents are open
 * to the workspace; a creator-only agent's computer is its creator's and the workspace owner's; a computer whose
 * agent is gone falls to the workspace owner so it can still be stopped. Provider references, leases and desktop
 * tickets never appear. Null without access or when Computers are off.
 */
export const list = query({
  args: { workspaceId: v.string() },
  handler: async (ctx, { workspaceId }) => {
    let viewer: Viewer
    try {
      viewer = await requireNativeWorkspace(ctx, workspaceId)
      await requireNativeDeploymentFeature(ctx, 'computers')
    } catch {
      return null
    }
    const rows = await ctx.db.query('computers').withIndex('by_workspaceId', q => q.eq('workspaceId', workspaceId)).collect()
    const visible: Doc<'computers'>[] = []
    for (const row of rows) if (await canSee(ctx, viewer, row)) visible.push(row)
    return visible.sort((a, b) => a.createdAt - b.createdAt).map(row => ({
      id: row.id,
      workspaceId: row.workspaceId,
      ownerType: row.ownerType,
      ownerId: row.ownerId,
      provider: row.provider,
      providerRef: null,
      size: row.size,
      status: row.status,
      name: row.name ?? null,
      createdBy: row.createdBy,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      lastActiveAt: row.lastActiveAt ?? null,
      controlledByUserId: row.controlledByUserId,
      controlTakenAt: row.controlTakenAt,
    }))
  },
})

async function canSee(ctx: Parameters<typeof requireNativeWorkspace>[0], viewer: Viewer, row: Doc<'computers'>): Promise<boolean> {
  if (row.ownerType === 'user') return row.ownerId === viewer.userId
  const agent = await ctx.db.query('workspaceAgentDefinitions').withIndex('by_agentId', q => q.eq('agentId', row.ownerId)).unique()
  const owner = viewer.membership.role === 'owner'
  if (!agent || agent.workspaceId !== row.workspaceId || agent.deletedAt !== undefined) return owner
  if ((agent.visibility ?? 'workspace') === 'workspace') return true
  return agent.createdByPrincipalId === viewer.principal.principalId || owner
}
