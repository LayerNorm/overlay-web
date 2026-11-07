import { v } from 'convex/values'
import { mutation, query, type QueryCtx } from '../_generated/server'
import type { Id } from '../_generated/dataModel'
import { requireNativeWorkspace } from '../lib/nativeViewer'
import { requireNativeCapability } from '../lib/nativeCapabilities'
import { assertCanCreateInScope, listScopedRows, scopeContextLoader } from '../lib/resourceScope'

const MAX = { name: 200, description: 2_000, instructions: 100_000 }

/** The signed-in member with `skills.use` and the Skills deployment feature, the checks `/api/v1/skills` makes. */
async function skillViewer(ctx: QueryCtx, workspaceId: string) {
  const viewer = await requireNativeWorkspace(ctx, workspaceId)
  await requireNativeCapability(ctx, viewer.userId, 'skills.use')
  return viewer
}

function required(value: string, field: keyof typeof MAX): string {
  const trimmed = value.trim()
  if (!trimmed) throw new Error(`SKILL_INVALID:${field}_required`)
  if (trimmed.length > MAX[field]) throw new Error(`SKILL_INVALID:${field}_too_long`)
  return trimmed
}

async function editableSkill(ctx: QueryCtx, userId: string, workspaceId: string, skillId: Id<'skills'>) {
  const skill = await ctx.db.get(skillId)
  if (!skill || skill.workspaceId !== workspaceId || !(await scopeContextLoader(ctx, userId).canEdit(skill))) throw new Error('Unauthorized')
  return skill
}

/** The skills a member can see in a view, live, with whether they may edit each. Null without access. */
export const list = query({
  args: { workspaceId: v.string(), view: v.optional(v.union(v.literal('personal'), v.literal('workspace'), v.literal('archived'))) },
  handler: async (ctx, { workspaceId, view }) => {
    let viewer
    try {
      viewer = await skillViewer(ctx, workspaceId)
    } catch {
      return null
    }
    const rows = await listScopedRows(ctx, {
      userId: viewer.userId, workspaceId, view,
      fetchMine: async () => await ctx.db.query('skills').withIndex('by_userId', q => q.eq('userId', viewer.userId)).order('desc').collect()
        .then(rows => rows.filter(row => row.workspaceId === workspaceId)),
      fetchShared: async ws => await ctx.db.query('skills')
        .withIndex('by_workspaceId_scope_archivedAt', q => q.eq('workspaceId', ws).eq('scope', 'workspace')).collect(),
    })
    const access = scopeContextLoader(ctx, viewer.userId)
    return await Promise.all(rows
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map(async row => ({ ...row, canEdit: await access.canEdit(row) })))
  },
})

export const create = mutation({
  args: {
    workspaceId: v.string(),
    name: v.string(),
    description: v.string(),
    instructions: v.string(),
    enabled: v.optional(v.boolean()),
    scope: v.optional(v.union(v.literal('personal'), v.literal('workspace'))),
  },
  handler: async (ctx, args) => {
    const viewer = await skillViewer(ctx, args.workspaceId)
    const scope = await assertCanCreateInScope(ctx, { kind: 'extension', scope: args.scope, workspaceId: args.workspaceId, userId: viewer.userId })
    const now = Date.now()
    return await ctx.db.insert('skills', {
      userId: viewer.userId,
      workspaceId: args.workspaceId,
      scope,
      name: required(args.name, 'name'),
      description: required(args.description, 'description'),
      instructions: required(args.instructions, 'instructions'),
      ...(args.enabled !== undefined ? { enabled: args.enabled } : {}),
      version: 1,
      createdAt: now,
      updatedAt: now,
    })
  },
})

/** Edits a skill. A stale form (its `expectedUpdatedAt` no longer current) is refused instead of overwriting. */
export const update = mutation({
  args: {
    workspaceId: v.string(),
    skillId: v.id('skills'),
    expectedUpdatedAt: v.optional(v.number()),
    name: v.optional(v.string()),
    description: v.optional(v.string()),
    instructions: v.optional(v.string()),
    enabled: v.optional(v.boolean()),
  },
  returns: v.null(),
  handler: async (ctx, { workspaceId, skillId, expectedUpdatedAt, ...updates }) => {
    const viewer = await skillViewer(ctx, workspaceId)
    const skill = await editableSkill(ctx, viewer.userId, workspaceId, skillId)
    if (expectedUpdatedAt !== undefined && skill.updatedAt !== expectedUpdatedAt) throw new Error('SKILL_INVALID:conflict')
    const patch: Record<string, unknown> = { updatedAt: Math.max(Date.now(), skill.updatedAt + 1) }
    if (updates.name !== undefined) patch.name = required(updates.name, 'name')
    if (updates.description !== undefined) patch.description = required(updates.description, 'description')
    if (updates.instructions !== undefined) patch.instructions = required(updates.instructions, 'instructions')
    if (updates.enabled !== undefined) patch.enabled = updates.enabled
    if (updates.name !== undefined || updates.description !== undefined || updates.instructions !== undefined) {
      patch.version = (skill.version ?? 1) + 1
    }
    await ctx.db.patch(skillId, patch)
    return null
  },
})

export const remove = mutation({
  args: { workspaceId: v.string(), skillId: v.id('skills') },
  returns: v.null(),
  handler: async (ctx, { workspaceId, skillId }) => {
    const viewer = await skillViewer(ctx, workspaceId)
    await editableSkill(ctx, viewer.userId, workspaceId, skillId)
    await ctx.db.delete(skillId)
    return null
  },
})
