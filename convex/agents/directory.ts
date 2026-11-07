import { v } from 'convex/values'
import type { Doc } from '../_generated/dataModel'
import { mutation, query } from '../_generated/server'
import type { QueryCtx } from '../_generated/server'
import { requireNativeWorkspace } from '../lib/nativeViewer'
import {
  directoryValue,
  ensureWorkspaceChiefs,
  isActiveNonGuestHumanOwner,
} from '../collaboration/agents'

type Viewer = Awaited<ReturnType<typeof requireNativeWorkspace>>
type Row = Doc<'workspaceAgentDefinitions'>

/** Reads answer null rather than throwing for a caller without access, so a list never crashes its page. */
async function viewerOrNull(ctx: QueryCtx, workspaceId: string): Promise<Viewer | null> {
  try {
    return await requireNativeWorkspace(ctx, workspaceId)
  } catch (error) {
    const message = error instanceof Error ? error.message : ''
    if (message === 'UNAUTHENTICATED' || message === 'WORKSPACE_ACCESS_DENIED') return null
    throw error
  }
}

/** Creator-only agents are invisible to everyone else, so their existence never leaks. */
export function canSee(row: Row, viewer: Viewer) {
  return (row.visibility ?? 'workspace') !== 'creator' || row.createdByPrincipalId === viewer.principal.principalId
}

function canEdit(row: Row, viewer: Viewer) {
  const role = viewer.membership.role
  if (row.agentRole === 'personal_chief') return role !== 'guest' && row.chiefOwnerUserId === viewer.userId
  if (row.agentRole === 'workspace_chief' && role === 'guest') return false
  if (role === 'owner' || role === 'admin') return true
  return row.createdByPrincipalId === viewer.principal.principalId
}

async function project(ctx: QueryCtx, row: Row, viewer: Viewer) {
  const { agentId, ...value } = await directoryValue(ctx, row)
  const creator = await ctx.db.query('workspacePrincipals')
    .withIndex('by_principalId', q => q.eq('principalId', row.createdByPrincipalId)).unique()
  const createdByDisplayName = creator?.workspaceId === row.workspaceId
    ? creator.displayNameOverride ?? creator.displayName
    : undefined
  return {
    ...value,
    visibility: value.visibility ?? 'workspace',
    id: agentId,
    canEdit: canEdit(row, viewer),
    ...(createdByDisplayName ? { createdByDisplayName } : {}),
  }
}

export async function visibleRow(ctx: QueryCtx, row: Row | null, viewer: Viewer) {
  if (!row || row.workspaceId !== viewer.workspaceId || row.deletedAt || !canSee(row, viewer)) return null
  if (row.agentRole === 'personal_chief' && row.chiefOwnerUserId
    && !await isActiveNonGuestHumanOwner(ctx, row.workspaceId, row.chiefOwnerUserId)) return null
  return row
}

/** The live agent directory for one workspace, as the signed-in member may see it. */
export const list = query({
  args: { workspaceId: v.string(), includeArchived: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const viewer = await viewerOrNull(ctx, args.workspaceId)
    if (!viewer) return null
    const rows = await ctx.db.query('workspaceAgentDefinitions')
      .withIndex('by_workspaceId', q => q.eq('workspaceId', args.workspaceId)).collect()
    const visible: Row[] = []
    for (const row of rows) {
      if (row.archivedAt && !args.includeArchived) continue
      if (await visibleRow(ctx, row, viewer)) visible.push(row)
    }
    visible.sort((a, b) => a.name.localeCompare(b.name) || a.agentId.localeCompare(b.agentId))
    return {
      agents: await Promise.all(visible.map(row => project(ctx, row, viewer))),
      canCreate: viewer.membership.role !== 'guest',
      viewerPrincipalId: viewer.principal.principalId,
    }
  },
})

/** One live agent, or null when it is archived, missing or invisible to the viewer. */
export const get = query({
  args: { workspaceId: v.string(), agentId: v.string() },
  handler: async (ctx, args) => {
    const viewer = await viewerOrNull(ctx, args.workspaceId)
    if (!viewer) return null
    const row = await ctx.db.query('workspaceAgentDefinitions')
      .withIndex('by_agentId', q => q.eq('agentId', args.agentId)).unique()
    const visible = await visibleRow(ctx, row, viewer)
    return visible && !visible.archivedAt ? await project(ctx, visible, viewer) : null
  },
})

/** Provisions the viewer's chief agents. Idempotent; the directory query reflects the result. */
export const ensureChiefs = mutation({
  args: { workspaceId: v.string() },
  handler: async (ctx, args) => {
    const viewer = await requireNativeWorkspace(ctx, args.workspaceId)
    if (viewer.membership.role === 'guest') return null
    await ensureWorkspaceChiefs(ctx, {
      workspaceId: args.workspaceId,
      actorUserId: viewer.userId,
      actorPrincipalId: viewer.principal.principalId,
      now: Date.now(),
    })
    return null
  },
})
