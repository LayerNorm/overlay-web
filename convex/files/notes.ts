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

function normalizeNoteDoc<T extends {
  createdAt?: number
  updatedAt: number
}>(note: T): T & { createdAt: number; updatedAt: number } {
  return {
    ...note,
    createdAt: note.createdAt ?? note.updatedAt,
    updatedAt: note.updatedAt,
  }
}

// Returns only notes NOT scoped to a project (for the main Notes tab).
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
    const all = await ctx.db
      .query('notes')
      .withIndex('by_userId', (q) => q.eq('userId', userId))
      .order('desc')
      .take(300)
    return all
      .map(normalizeNoteDoc)
      .filter((n) => !n.projectId)
      .filter((n) => (updatedSince !== undefined ? n.updatedAt > updatedSince : true))
      .filter((n) => (includeDeleted ? true : !n.deletedAt))
      .filter((n) => (workspaceId !== undefined ? n.workspaceId === workspaceId : true))
      .slice(0, 200)
  },
})

// Returns notes belonging to a specific project.
export const listByProject = query({
  args: {
    projectId: v.string(),
    userId: v.string(),
    workspaceId: v.optional(v.string()),
    accessToken: v.optional(v.string()),
    serverSecret: v.optional(v.string()),
    updatedSince: v.optional(v.number()),
    includeDeleted: v.optional(v.boolean()),
  },
  handler: async (ctx, { projectId, userId, workspaceId, accessToken, serverSecret, updatedSince, includeDeleted }) => {
    try {
      await authorizeUserAccess({ userId, accessToken, serverSecret })
    } catch {
      return []
    }
    const notes = await ctx.db
      .query('notes')
      .withIndex('by_projectId', (q) => q.eq('projectId', projectId))
      .order('desc')
      .collect()
    return notes
      .map(normalizeNoteDoc)
      .filter((note) => note.userId === userId)
      .filter((note) => (updatedSince !== undefined ? note.updatedAt > updatedSince : true))
      .filter((note) => (includeDeleted ? true : !note.deletedAt))
      .filter((note) => (workspaceId !== undefined ? note.workspaceId === workspaceId : true))
  },
})

export const get = query({
  args: {
    noteId: v.id('notes'),
    userId: v.string(),
    workspaceId: v.optional(v.string()),
    accessToken: v.optional(v.string()),
    serverSecret: v.optional(v.string()),
  },
  handler: async (ctx, { noteId, userId, workspaceId, accessToken, serverSecret }) => {
    try {
      await authorizeUserAccess({ userId, accessToken, serverSecret })
    } catch {
      return null
    }
    const note = await ctx.db.get(noteId)
    return note?.userId === userId && !note.deletedAt && (workspaceId === undefined || note.workspaceId === workspaceId) ? normalizeNoteDoc(note) : null
  },
})

export const create = mutation({
  args: {
    userId: v.string(),
    workspaceId: v.optional(v.string()),
    accessToken: v.optional(v.string()),
    serverSecret: v.optional(v.string()),
    clientId: v.optional(v.string()),
    title: v.string(),
    content: v.string(),
    tags: v.array(v.string()),
    projectId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await authorizeUserAccess(args)
    if (args.clientId?.trim()) {
      const existing = await ctx.db
        .query('notes')
        .withIndex('by_userId_clientId', (q) => q.eq('userId', args.userId).eq('clientId', args.clientId!.trim()))
        .first()
      if (existing) {
        return existing._id
      }
    }
    if (args.projectId) {
      const project = await ctx.db.get(args.projectId as Id<'projects'>)
      if (!project || project.userId !== args.userId || project.deletedAt) {
        throw new Error('Unauthorized')
      }
    }
    const now = Date.now()
    return await ctx.db.insert('notes', {
      userId: args.userId,
      workspaceId: args.workspaceId,
      clientId: args.clientId?.trim() || undefined,
      title: args.title,
      content: args.content,
      tags: args.tags,
      projectId: args.projectId,
      createdAt: now,
      updatedAt: now,
    })
  },
})

export const update = mutation({
  args: {
    userId: v.string(),
    workspaceId: v.optional(v.string()),
    accessToken: v.optional(v.string()),
    serverSecret: v.optional(v.string()),
    noteId: v.id('notes'),
    title: v.optional(v.string()),
    content: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
    projectId: v.optional(v.string()),
  },
  handler: async (ctx, { userId, workspaceId, accessToken, serverSecret, noteId, ...updates }) => {
    await authorizeUserAccess({ userId, accessToken, serverSecret })
    const existing = await ctx.db.get(noteId)
    if (!existing || existing.userId !== userId || existing.deletedAt || (workspaceId !== undefined && existing.workspaceId !== workspaceId)) {
      throw new Error('Unauthorized')
    }
    if (updates.projectId !== undefined && updates.projectId !== null) {
      const project = await ctx.db.get(updates.projectId as Id<'projects'>)
      if (!project || project.userId !== userId || project.deletedAt) {
        throw new Error('Unauthorized')
      }
    }
    const patch: Record<string, unknown> = { updatedAt: Date.now() }
    if (updates.title !== undefined) patch.title = updates.title
    if (updates.content !== undefined) patch.content = updates.content
    if (updates.tags !== undefined) patch.tags = updates.tags
    if (updates.projectId !== undefined) patch.projectId = updates.projectId || undefined
    await ctx.db.patch(noteId, patch)
  },
})

export const remove = mutation({
  args: {
    noteId: v.id('notes'),
    userId: v.string(),
    workspaceId: v.optional(v.string()),
    accessToken: v.optional(v.string()),
    serverSecret: v.optional(v.string()),
  },
  handler: async (ctx, { noteId, userId, workspaceId, accessToken, serverSecret }) => {
    await authorizeUserAccess({ userId, accessToken, serverSecret })
    const existing = await ctx.db.get(noteId)
    if (!existing || existing.userId !== userId || existing.deletedAt || (workspaceId !== undefined && existing.workspaceId !== workspaceId)) {
      throw new Error('Unauthorized')
    }
    await ctx.db.patch(noteId, {
      deletedAt: Date.now(),
      updatedAt: Date.now(),
    })
  },
})
