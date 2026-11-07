import { v } from 'convex/values'
import { query, type QueryCtx } from '../_generated/server'
import type { Doc } from '../_generated/dataModel'
import { requireNativeWorkspace } from '../lib/nativeViewer'
import { visibleRow } from '../agents/directory'
import { agentIdFromMemoryOwnerId, agentMemoryOwnerId } from '../../src/shared/agents/agent-memory'
import { memoriesToClientListRows } from '../../src/shared/knowledge/memory-display-segments'

type Viewer = Awaited<ReturnType<typeof requireNativeWorkspace>>
type Attribution = { email?: string; name: string; principalId?: string }

const MEMORY_LIST_LIMIT = 100

/** Who wrote a memory, as this viewer may know them: active members, and agents the viewer can see. */
async function attributionFor(ctx: QueryCtx, viewer: Viewer, ownerId: string): Promise<Attribution | null> {
  const agentId = agentIdFromMemoryOwnerId(ownerId)
  if (agentId) {
    const agent = await ctx.db.query('workspaceAgentDefinitions').withIndex('by_agentId', q => q.eq('agentId', agentId)).unique()
    const visible = await visibleRow(ctx, agent, viewer)
    return visible ? { name: visible.name, principalId: visible.principalId } : null
  }
  const principal = await ctx.db.query('workspacePrincipals')
    .withIndex('by_workspaceId_userId', q => q.eq('workspaceId', viewer.workspaceId).eq('userId', ownerId)).unique()
  if (!principal || principal.type !== 'human' || principal.archivedAt !== undefined) return null
  const membership = await ctx.db.query('workspaceMemberships')
    .withIndex('by_workspaceId_principalId', q => q.eq('workspaceId', viewer.workspaceId).eq('principalId', principal.principalId)).unique()
  if (membership?.status !== 'active') return null
  return { email: principal.email, name: principal.displayNameOverride ?? principal.displayName, principalId: principal.principalId }
}

/** The memory owner id behind a member or agent principal in this workspace, or null when there is none to show. */
async function ownerIdForPrincipal(ctx: QueryCtx, viewer: Viewer, principalId: string): Promise<string | null> {
  const principal = await ctx.db.query('workspacePrincipals').withIndex('by_principalId', q => q.eq('principalId', principalId)).unique()
  if (!principal || principal.workspaceId !== viewer.workspaceId) return null
  if (principal.type === 'human') return principal.userId ?? null
  if (principal.type !== 'agent' || !principal.agentId) return null
  const agent = await ctx.db.query('workspaceAgentDefinitions').withIndex('by_agentId', q => q.eq('agentId', principal.agentId!)).unique()
  return await visibleRow(ctx, agent, viewer) ? agentMemoryOwnerId(principal.agentId) : null
}

/**
 * The workspace's memories, live, newest first: everyone's shared memories plus the viewer's own owner-only ones,
 * optionally narrowed to one member or agent. Null when the viewer is not an active member.
 */
export const list = query({
  args: { workspaceId: v.string(), ownerPrincipalId: v.optional(v.string()) },
  handler: async (ctx, { workspaceId, ownerPrincipalId }) => {
    let viewer: Viewer
    try {
      viewer = await requireNativeWorkspace(ctx, workspaceId)
    } catch {
      return null
    }
    let rows: Doc<'memories'>[]
    if (ownerPrincipalId) {
      const ownerId = await ownerIdForPrincipal(ctx, viewer, ownerPrincipalId)
      if (!ownerId) return []
      rows = await ctx.db.query('memories')
        .withIndex('by_workspaceId_userId', q => q.eq('workspaceId', workspaceId).eq('userId', ownerId))
        .order('desc').take(MEMORY_LIST_LIMIT)
    } else {
      rows = await ctx.db.query('memories')
        .withIndex('by_workspaceId', q => q.eq('workspaceId', workspaceId))
        .order('desc').take(MEMORY_LIST_LIMIT)
    }
    const visible = rows.filter(memory => !memory.deletedAt && (memory.visibility !== 'owner' || memory.userId === viewer.userId))
    const attributions = new Map<string, Attribution>()
    for (const ownerId of new Set(visible.map(memory => memory.userId))) {
      const attribution = await attributionFor(ctx, viewer, ownerId)
      if (attribution) attributions.set(ownerId, attribution)
    }
    return memoriesToClientListRows(
      visible.map(memory => ({ ...memory, updatedAt: memory.updatedAt ?? memory.createdAt })),
      { attributionsByUserId: attributions, viewerUserId: viewer.userId },
    )
  },
})
