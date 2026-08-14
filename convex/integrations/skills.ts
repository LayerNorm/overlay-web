import { v } from 'convex/values'
import { mutation, query } from '../_generated/server'
import { requireAccessToken, validateServerSecret } from '../lib/auth'
import type { Id } from '../_generated/dataModel'

async function authorizeUserAccess(params: {
  accessToken?: string
  serverSecret?: string
  userId: string
}) {
  if (validateServerSecret(params.serverSecret)) {
    return
  }
  await requireAccessToken(params.accessToken ?? '', params.userId)
}

export const list = query({
  args: { userId: v.string(), workspaceId: v.optional(v.string()), accessToken: v.optional(v.string()), serverSecret: v.optional(v.string()), projectId: v.optional(v.string()) },
  handler: async (ctx, { userId, workspaceId, accessToken, serverSecret, projectId }) => {
    try {
      await authorizeUserAccess({ userId, accessToken, serverSecret })
    } catch {
      return []
    }
    const all = await ctx.db
      .query('skills')
      .withIndex('by_userId', (q) => q.eq('userId', userId))
      .order('desc')
      .collect()
    if (projectId !== undefined) {
      return all.filter((s) => s.projectId === projectId).filter((s) => (workspaceId !== undefined ? s.workspaceId === workspaceId : true))
    }
    // Global skills = no projectId
    return all.filter((s) => !s.projectId).filter((s) => (workspaceId !== undefined ? s.workspaceId === workspaceId : true))
  },
})

export const get = query({
  args: { skillId: v.id('skills'), userId: v.string(), workspaceId: v.optional(v.string()), accessToken: v.optional(v.string()), serverSecret: v.optional(v.string()) },
  handler: async (ctx, { skillId, userId, workspaceId, accessToken, serverSecret }) => {
    try {
      await authorizeUserAccess({ userId, accessToken, serverSecret })
    } catch {
      return null
    }
    const skill = await ctx.db.get(skillId)
    return skill?.userId === userId && (workspaceId === undefined || skill.workspaceId === workspaceId) ? skill : null
  },
})

/**
 * Lightweight skill directory: returns only _id, name, description, enabled.
 * Full instructions are NOT included — they are loaded on demand via
 * getInstructions. This keeps the skill context within a small token budget
 * instead of injecting every skill's full instructions into every turn.
 */
export const listDirectory = query({
  args: { userId: v.string(), workspaceId: v.optional(v.string()), accessToken: v.optional(v.string()), serverSecret: v.optional(v.string()), projectId: v.optional(v.string()) },
  handler: async (ctx, { userId, workspaceId, accessToken, serverSecret, projectId }) => {
    try {
      await authorizeUserAccess({ userId, accessToken, serverSecret })
    } catch {
      return []
    }
    const all = await ctx.db
      .query('skills')
      .withIndex('by_userId', (q) => q.eq('userId', userId))
      .order('desc')
      .collect()
    const filtered = (projectId !== undefined
      ? all.filter((s) => s.projectId === projectId)
      : all.filter((s) => !s.projectId)
    ).filter((s) => (workspaceId !== undefined ? s.workspaceId === workspaceId : true))
    return filtered.map((s) => ({
      _id: s._id,
      name: s.name,
      description: s.description,
      enabled: s.enabled ?? true,
    }))
  },
})

/**
 * Load full instructions for a single skill on demand.
 * Used by the list_skills tool when the agent decides a skill is relevant.
 */
export const getInstructions = query({
  args: { skillId: v.id('skills'), userId: v.string(), accessToken: v.optional(v.string()), serverSecret: v.optional(v.string()) },
  handler: async (ctx, { skillId, userId, accessToken, serverSecret }) => {
    try {
      await authorizeUserAccess({ userId, accessToken, serverSecret })
    } catch {
      return null
    }
    const skill = await ctx.db.get(skillId)
    if (!skill || skill.userId !== userId) return null
    return { _id: skill._id, name: skill.name, instructions: skill.instructions }
  },
})

export const create = mutation({
  args: {
    userId: v.string(),
    workspaceId: v.optional(v.string()),
    accessToken: v.optional(v.string()),
    serverSecret: v.optional(v.string()),
    name: v.string(),
    description: v.string(),
    instructions: v.string(),
    enabled: v.optional(v.boolean()),
    projectId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await authorizeUserAccess(args)
    if (args.projectId) {
      const project = await ctx.db.get(args.projectId as Id<'projects'>)
      if (!project || project.userId !== args.userId) {
        throw new Error('Unauthorized')
      }
    }
    const now = Date.now()
    return await ctx.db.insert('skills', {
      userId: args.userId,
      workspaceId: args.workspaceId,
      name: args.name,
      description: args.description,
      instructions: args.instructions,
      ...(args.enabled !== undefined ? { enabled: args.enabled } : {}),
      projectId: args.projectId,
      version: 1,
      createdAt: now,
      updatedAt: now,
    })
  },
})

export const update = mutation({
  args: {
    skillId: v.id('skills'),
    userId: v.string(),
    workspaceId: v.optional(v.string()),
    accessToken: v.optional(v.string()),
    serverSecret: v.optional(v.string()),
    name: v.optional(v.string()),
    description: v.optional(v.string()),
    instructions: v.optional(v.string()),
    enabled: v.optional(v.boolean()),
  },
  handler: async (ctx, { skillId, userId, workspaceId, accessToken, serverSecret, ...updates }) => {
    await authorizeUserAccess({ userId, accessToken, serverSecret })
    const skill = await ctx.db.get(skillId)
    if (!skill || skill.userId !== userId || (workspaceId !== undefined && skill.workspaceId !== workspaceId)) {
      throw new Error('Unauthorized')
    }
    const patch: Record<string, unknown> = { updatedAt: Date.now() }
    if (updates.name !== undefined) patch.name = updates.name
    if (updates.description !== undefined) patch.description = updates.description
    if (updates.instructions !== undefined) patch.instructions = updates.instructions
    if (updates.enabled !== undefined) patch.enabled = updates.enabled
    if (
      updates.name !== undefined ||
      updates.description !== undefined ||
      updates.instructions !== undefined
    ) {
      patch.version = (skill.version ?? 1) + 1
    }
    await ctx.db.patch(skillId, patch)
  },
})

export const remove = mutation({
  args: { skillId: v.id('skills'), userId: v.string(), workspaceId: v.optional(v.string()), accessToken: v.optional(v.string()), serverSecret: v.optional(v.string()) },
  handler: async (ctx, { skillId, userId, workspaceId, accessToken, serverSecret }) => {
    await authorizeUserAccess({ userId, accessToken, serverSecret })
    const skill = await ctx.db.get(skillId)
    if (!skill || skill.userId !== userId || (workspaceId !== undefined && skill.workspaceId !== workspaceId)) {
      throw new Error('Unauthorized')
    }
    await ctx.db.delete(skillId)
  },
})
