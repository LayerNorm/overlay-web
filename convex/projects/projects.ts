import { v } from 'convex/values'
import { mutation, query, type MutationCtx } from '../_generated/server'
import type { Doc, Id } from '../_generated/dataModel'
import { requireAccessToken, validateServerSecret } from '../lib/auth'
import { assertWorkspaceMembership } from '../lib/workspaceMembership'

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
  args: {
    userId: v.string(),
    workspaceId: v.optional(v.string()),
    accessToken: v.optional(v.string()),
    serverSecret: v.optional(v.string()),
    updatedSince: v.optional(v.number()),
    includeDeleted: v.optional(v.boolean()),
  },
  handler: async (ctx, { userId, workspaceId, accessToken, serverSecret, updatedSince, includeDeleted }) => {
    try {
      await authorizeUserAccess({ userId, accessToken, serverSecret })
    } catch {
      return []
    }
    const projects = await ctx.db
      .query('projects')
      .withIndex('by_userId', (q) => q.eq('userId', userId))
      .order('asc')
      .collect()
    return projects
      .filter((project) => (updatedSince !== undefined ? project.updatedAt > updatedSince : true))
      .filter((project) => (includeDeleted ? true : !project.deletedAt))
      .filter((project) => (workspaceId !== undefined ? project.workspaceId === workspaceId : true))
  },
})

export const get = query({
  args: { projectId: v.id('projects'), userId: v.string(), workspaceId: v.optional(v.string()), accessToken: v.optional(v.string()), serverSecret: v.optional(v.string()) },
  handler: async (ctx, { projectId, userId, workspaceId, accessToken, serverSecret }) => {
    try {
      await authorizeUserAccess({ userId, accessToken, serverSecret })
    } catch {
      return null
    }
    const project = await ctx.db.get(projectId)
    return project?.userId === userId && !project.deletedAt && (workspaceId === undefined || project.workspaceId === workspaceId) ? project : null
  },
})

export const create = mutation({
  args: {
    userId: v.string(),
    workspaceId: v.optional(v.string()),
    accessToken: v.optional(v.string()),
    serverSecret: v.optional(v.string()),
    clientId: v.optional(v.string()),
    name: v.string(),
    instructions: v.optional(v.string()),
    parentId: v.optional(v.string()),
  },
  handler: async (ctx, { userId, workspaceId, accessToken, serverSecret, clientId, name, instructions, parentId }) => {
    await authorizeUserAccess({ userId, accessToken, serverSecret })
    await assertWorkspaceMembership(ctx, { userId, workspaceId })
    if (clientId?.trim()) {
      const existing = await ctx.db
        .query('projects')
        .withIndex('by_userId_clientId', (q) => q.eq('userId', userId).eq('clientId', clientId.trim()))
        .first()
      if (existing) {
        if (existing.deletedAt) {
          await validateParentChange(ctx, {
            parentId,
            projectId: existing._id,
            userId,
          })
          await ctx.db.patch(existing._id, {
            deletedAt: undefined,
            instructions: instructions?.trim() || undefined,
            name,
            parentId,
            updatedAt: Date.now(),
          })
        }
        return existing._id
      }
    }
    await validateParentChange(ctx, { parentId, userId })
    const now = Date.now()
    return await ctx.db.insert('projects', {
      userId,
      workspaceId,
      clientId: clientId?.trim() || undefined,
      name,
      instructions: instructions?.trim() || undefined,
      parentId,
      createdAt: now,
      updatedAt: now,
    })
  },
})

export const update = mutation({
  args: {
    projectId: v.id('projects'),
    userId: v.string(),
    workspaceId: v.optional(v.string()),
    accessToken: v.optional(v.string()),
    serverSecret: v.optional(v.string()),
    name: v.optional(v.string()),
    instructions: v.optional(v.union(v.string(), v.null())),
    parentId: v.optional(v.union(v.string(), v.null())),
  },
  handler: async (ctx, { projectId, userId, workspaceId, accessToken, serverSecret, name, instructions, parentId }) => {
    await authorizeUserAccess({ userId, accessToken, serverSecret })
    const project = await ctx.db.get(projectId)
    if (!project || project.userId !== userId || (workspaceId !== undefined && project.workspaceId !== workspaceId)) {
      throw new Error('Unauthorized')
    }
    if (parentId !== undefined && parentId !== null) {
      await validateParentChange(ctx, { parentId, projectId, userId })
    }
    const patch: Record<string, unknown> = { updatedAt: Date.now() }
    if (name !== undefined) patch.name = name
    if (instructions !== undefined) patch.instructions = instructions?.trim() || undefined
    if (parentId !== undefined) patch.parentId = parentId || undefined
    await ctx.db.patch(projectId, patch)
  },
})

// Removes one project and its linked records. The repository layer handles descendant traversal.
export const remove = mutation({
  args: { projectId: v.id('projects'), userId: v.string(), workspaceId: v.optional(v.string()), accessToken: v.optional(v.string()), serverSecret: v.optional(v.string()) },
  handler: async (ctx, { projectId, userId, workspaceId, accessToken, serverSecret }) => {
    await authorizeUserAccess({ userId, accessToken, serverSecret })
    const project = await ctx.db.get(projectId)
    if (!project || project.userId !== userId || (workspaceId !== undefined && project.workspaceId !== workspaceId)) {
      throw new Error('Unauthorized')
    }
    const pid = projectId as string
    const now = Date.now()

    const [conversations, notes, files, skills, mcpServers] = await Promise.all([
      ctx.db.query('conversations').withIndex('by_projectId', (q) => q.eq('projectId', pid)).collect(),
      ctx.db.query('notes').withIndex('by_projectId', (q) => q.eq('projectId', pid)).collect(),
      ctx.db.query('files').withIndex('by_projectId', (q) => q.eq('projectId', pid)).collect(),
      ctx.db.query('skills').withIndex('by_projectId', (q) => q.eq('projectId', pid)).collect(),
      ctx.db.query('mcpServers').withIndex('by_projectId', (q) => q.eq('projectId', pid)).collect(),
    ])

    for (const conv of conversations) {
      if (conv.userId !== userId) continue
      await ctx.db.patch(conv._id, {
        deletedAt: now,
        updatedAt: now,
        lastModified: now,
      })
    }
    for (const note of notes) {
      if (note.userId !== userId) continue
      await ctx.db.patch(note._id, { deletedAt: now, updatedAt: now })
    }
    for (const file of files) {
      if (file.userId !== userId) continue
      await ctx.db.patch(file._id, {
        deletedAt: now,
        indexStatus: 'skipped',
        updatedAt: now,
      })
    }
    for (const skill of skills) {
      if (skill.userId === userId) await ctx.db.delete(skill._id)
    }
    for (const server of mcpServers) {
      if (server.userId !== userId) continue
      const executions = await ctx.db
        .query('mcpToolExecutions')
        .withIndex('by_mcpServerId_createdAt', (q) => q.eq('mcpServerId', server._id))
        .collect()
      for (const execution of executions) await ctx.db.delete(execution._id)
      await ctx.db.delete(server._id)
    }

    await ctx.db.patch(projectId, { deletedAt: now, updatedAt: now })
  },
})

async function validateParentChange(
  ctx: MutationCtx,
  args: {
    parentId?: string
    projectId?: Id<'projects'>
    userId: string
  },
): Promise<void> {
  if (!args.parentId) return
  if (args.projectId && args.parentId === args.projectId) {
    throw new Error('Project cannot be its own parent')
  }
  const parent = await ctx.db.get(args.parentId as Id<'projects'>)
  if (!parent || parent.userId !== args.userId || parent.deletedAt) {
    throw new Error('Invalid parent project')
  }
  const seen = new Set<string>(args.projectId ? [args.projectId] : [])
  let cursor: string | undefined = parent._id
  while (cursor) {
    if (seen.has(cursor)) {
      throw new Error('Project parent cycle detected')
    }
    seen.add(cursor)
    const ancestor: Doc<'projects'> | null = await ctx.db.get(cursor as Id<'projects'>)
    if (!ancestor || ancestor.userId !== args.userId || ancestor.deletedAt) break
    cursor = ancestor.parentId
  }
}
