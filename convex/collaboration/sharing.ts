import { v } from 'convex/values'
import type { Doc } from '../_generated/dataModel'
import { mutation, query } from '../_generated/server'
import type { MutationCtx, QueryCtx } from '../_generated/server'
import { requireServerSecret } from '../lib/auth'

const resourceType = v.union(
  v.literal('conversation'), v.literal('file'), v.literal('project'),
  v.literal('knowledge_base'), v.literal('automation'), v.literal('agent'),
)
const targetType = v.union(v.literal('principal'), v.literal('team'), v.literal('room'))
const accessRole = v.union(v.literal('viewer'), v.literal('operator'), v.literal('editor'))
const grantValidator = v.object({
  id: v.string(), workspaceId: v.string(), resourceType, resourceId: v.string(),
  targetType, targetId: v.string(), accessRole, grantedByPrincipalId: v.string(),
  createdAt: v.number(), updatedAt: v.number(),
})

export const upsertByServer = mutation({
  args: {
    serverSecret: v.string(), id: v.string(), workspaceId: v.string(), resourceType,
    resourceId: v.string(), targetType, targetId: v.string(), accessRole,
    grantedByPrincipalId: v.string(), now: v.number(),
  },
  returns: grantValidator,
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    await requireScope(ctx, args.workspaceId, args.resourceType, args.resourceId)
    await requirePrincipal(ctx, args.workspaceId, args.grantedByPrincipalId)
    await requireTarget(ctx, args.workspaceId, args.targetType, args.targetId)
    const existing = (await ctx.db.query('workspaceResourceGrants')
      .withIndex('by_workspaceId_resource', (q) => q
        .eq('workspaceId', args.workspaceId)
        .eq('resourceType', args.resourceType)
        .eq('resourceId', args.resourceId))
      .collect())
      .find((grant) => grant.targetType === args.targetType && grant.targetId === args.targetId)
    if (existing) {
      await ctx.db.patch(existing._id, {
        accessRole: args.accessRole,
        grantedByPrincipalId: args.grantedByPrincipalId,
        updatedAt: args.now,
      })
      // Return the persisted row, not the request: `args.now` is not a column,
      // so spreading it left updatedAt stale while Postgres returned the new
      // timestamp.
      return grantValue({
        ...existing,
        accessRole: args.accessRole,
        grantedByPrincipalId: args.grantedByPrincipalId,
        updatedAt: args.now,
      })
    }
    if (await ctx.db.query('workspaceResourceGrants')
      .withIndex('by_grantId', (q) => q.eq('grantId', args.id)).unique()) {
      throw new Error('WORKSPACE_RESOURCE_GRANT_ALREADY_EXISTS')
    }
    const id = await ctx.db.insert('workspaceResourceGrants', {
      grantId: args.id, workspaceId: args.workspaceId, resourceType: args.resourceType,
      resourceId: args.resourceId, targetType: args.targetType, targetId: args.targetId,
      accessRole: args.accessRole, grantedByPrincipalId: args.grantedByPrincipalId,
      createdAt: args.now, updatedAt: args.now,
    })
    return grantValue((await ctx.db.get(id))!)
  },
})

export const removeByServer = mutation({
  args: { serverSecret: v.string(), grantId: v.string(), workspaceId: v.string() },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const grant = await ctx.db.query('workspaceResourceGrants')
      .withIndex('by_grantId', (q) => q.eq('grantId', args.grantId)).unique()
    if (!grant || grant.workspaceId !== args.workspaceId) return false
    await ctx.db.delete(grant._id)
    return true
  },
})

export const listForResourceByServer = query({
  args: { serverSecret: v.string(), workspaceId: v.string(), resourceType, resourceId: v.string() },
  returns: v.array(grantValidator),
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const grants = await ctx.db.query('workspaceResourceGrants')
      .withIndex('by_workspaceId_resource', (q) => q
        .eq('workspaceId', args.workspaceId)
        .eq('resourceType', args.resourceType)
        .eq('resourceId', args.resourceId))
      .collect()
    return grants.map(grantValue).sort(orderGrants)
  },
})

export const listForTargetsByServer = query({
  args: {
    serverSecret: v.string(), workspaceId: v.string(), resourceType: v.optional(resourceType),
    principalIds: v.array(v.string()), teamIds: v.array(v.string()), roomIds: v.array(v.string()),
  },
  returns: v.array(grantValidator),
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const targets = new Set([
      ...args.principalIds.map((id) => `principal:${id}`),
      ...args.teamIds.map((id) => `team:${id}`),
      ...args.roomIds.map((id) => `room:${id}`),
    ])
    if (targets.size === 0) return []
    const grants = await ctx.db.query('workspaceResourceGrants')
      .withIndex('by_workspaceId_resource', (q) => q.eq('workspaceId', args.workspaceId))
      .collect()
    return grants
      .filter((grant) => (!args.resourceType || grant.resourceType === args.resourceType)
        && targets.has(`${grant.targetType}:${grant.targetId}`))
      .map(grantValue)
      .sort(orderGrants)
  },
})

async function requireScope(
  ctx: QueryCtx | MutationCtx,
  workspaceId: string,
  type: Doc<'workspaceResourceGrants'>['resourceType'],
  resourceId: string,
) {
  const scope = await ctx.db.query('workspaceResourceScopes')
    .withIndex('by_resource', (q) => q.eq('resourceType', type).eq('resourceId', resourceId))
    .unique()
  if (!scope || scope.workspaceId !== workspaceId) throw new Error('WORKSPACE_RESOURCE_SCOPE_MISMATCH')
}

async function requirePrincipal(ctx: QueryCtx | MutationCtx, workspaceId: string, principalId: string) {
  const principal = await ctx.db.query('workspacePrincipals')
    .withIndex('by_principalId', (q) => q.eq('principalId', principalId)).unique()
  if (!principal || principal.workspaceId !== workspaceId || principal.archivedAt) {
    throw new Error('WORKSPACE_PRINCIPAL_NOT_FOUND')
  }
}

async function requireTarget(
  ctx: QueryCtx | MutationCtx,
  workspaceId: string,
  type: Doc<'workspaceResourceGrants'>['targetType'],
  targetId: string,
) {
  if (type === 'principal') return await requirePrincipal(ctx, workspaceId, targetId)
  if (type === 'team') {
    const team = await ctx.db.query('workspaceTeams')
      .withIndex('by_teamId', (q) => q.eq('teamId', targetId)).unique()
    if (!team || team.workspaceId !== workspaceId || team.archivedAt) throw new Error('WORKSPACE_TEAM_NOT_FOUND')
    return
  }
  const conversationId = ctx.db.normalizeId('conversations', targetId)
  const room = conversationId ? await ctx.db.get(conversationId) : null
  if (!room || room.workspaceId !== workspaceId || room.conversationType === 'personal' || room.deletedAt) {
    throw new Error('WORKSPACE_ROOM_NOT_FOUND')
  }
}

function grantValue(row: Doc<'workspaceResourceGrants'> | (Doc<'workspaceResourceGrants'> & Record<string, unknown>)) {
  return {
    id: row.grantId,
    workspaceId: row.workspaceId,
    resourceType: row.resourceType,
    resourceId: row.resourceId,
    targetType: row.targetType,
    targetId: row.targetId,
    accessRole: row.accessRole,
    grantedByPrincipalId: row.grantedByPrincipalId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

function orderGrants(a: { createdAt: number; id: string }, b: { createdAt: number; id: string }) {
  return a.createdAt - b.createdAt || a.id.localeCompare(b.id)
}
