import { v } from 'convex/values'
import { internal } from '../_generated/api'
import { mutation, query } from '../_generated/server'
import { requireAccessToken, validateServerSecret } from '../lib/auth'

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

function normalizeMemoryDoc<T extends {
  updatedAt?: number
  createdAt: number
}>(memory: T): T & { updatedAt: number } {
  return {
    ...memory,
    updatedAt: memory.updatedAt ?? memory.createdAt,
  }
}

export const list = query({
  args: {
    userId: v.string(),
    accessToken: v.optional(v.string()),
    serverSecret: v.optional(v.string()),
    updatedSince: v.optional(v.number()),
    includeDeleted: v.optional(v.boolean()),
    projectId: v.optional(v.string()),
    conversationId: v.optional(v.string()),
    noteId: v.optional(v.string()),
  },
  handler: async (ctx, { userId, accessToken, serverSecret, updatedSince, includeDeleted, projectId, conversationId, noteId }) => {
    try {
      await authorizeUserAccess({ userId, accessToken, serverSecret })
    } catch {
      return []
    }
    const memories = await ctx.db
      .query('memories')
      .withIndex('by_userId', (q) => q.eq('userId', userId))
      .order('desc')
      .take(100)
    return memories
      .map(normalizeMemoryDoc)
      .filter((memory) => (updatedSince !== undefined ? memory.updatedAt > updatedSince : true))
      .filter((memory) => (includeDeleted ? true : !memory.deletedAt))
      .filter((memory) => (projectId !== undefined ? memory.projectId === projectId : true))
      .filter((memory) => (conversationId !== undefined ? memory.conversationId === conversationId : true))
      .filter((memory) => (noteId !== undefined ? memory.noteId === noteId : true))
  },
})

export const add = mutation({
  args: {
    userId: v.string(),
    workspaceId: v.optional(v.string()),
    accessToken: v.optional(v.string()),
    serverSecret: v.optional(v.string()),
    clientId: v.optional(v.string()),
    content: v.string(),
    source: v.union(v.literal('chat'), v.literal('note'), v.literal('manual')),
    type: v.optional(
      v.union(
        v.literal('preference'),
        v.literal('fact'),
        v.literal('project'),
        v.literal('decision'),
        v.literal('agent'),
      ),
    ),
    importance: v.optional(v.number()),
    projectId: v.optional(v.string()),
    conversationId: v.optional(v.string()),
    noteId: v.optional(v.string()),
    messageId: v.optional(v.string()),
    turnId: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
    actor: v.optional(v.union(v.literal('user'), v.literal('agent'))),
  },
  handler: async (ctx, args) => {
    await authorizeUserAccess(args)
    const MAX_MEMORY_BYTES = 50 * 1024 // 50 KB
    if (new TextEncoder().encode(args.content).byteLength > MAX_MEMORY_BYTES) {
      throw new Error(`Memory content exceeds size limit (max ${MAX_MEMORY_BYTES / 1024} KB)`)
    }
    if (args.clientId?.trim()) {
      const existing = await ctx.db
        .query('memories')
        .withIndex('by_userId_clientId', (q) => q.eq('userId', args.userId).eq('clientId', args.clientId!.trim()))
        .first()
      if (existing) {
        return existing._id
      }
    }

    // Deduplication: exact / near-exact content match for non-clientId inserts
    if (!args.clientId?.trim()) {
      const normalized = args.content.toLowerCase().replace(/\s+/g, ' ').trim()
      const candidates = await ctx.db
        .query('memories')
        .withIndex('by_userId', (q) => q.eq('userId', args.userId))
        .take(100)
      for (const candidate of candidates) {
        if (candidate.deletedAt) continue
        const candNorm = candidate.content.toLowerCase().replace(/\s+/g, ' ').trim()
        if (candNorm === normalized) {
          // Update freshness on exact duplicate
          await ctx.db.patch(candidate._id, { updatedAt: Date.now() })
          return candidate._id
        }
      }
    }

    const now = Date.now()
    const memoryId = await ctx.db.insert('memories', {
      userId: args.userId,
      workspaceId: args.workspaceId,
      clientId: args.clientId?.trim() || undefined,
      content: args.content,
      source: args.source,
      type: args.type,
      importance: args.importance,
      projectId: args.projectId,
      conversationId: args.conversationId,
      noteId: args.noteId,
      messageId: args.messageId,
      turnId: args.turnId,
      tags: args.tags,
      actor: args.actor,
      createdAt: now,
      updatedAt: now,
    })
    await ctx.scheduler.runAfter(0, internal.knowledge.knowledge.reindexMemoryInternal, { memoryId })
    return memoryId
  },
})

export const update = mutation({
  args: {
    userId: v.string(),
    accessToken: v.optional(v.string()),
    serverSecret: v.optional(v.string()),
    memoryId: v.id('memories'),
    content: v.string(),
    source: v.optional(v.union(v.literal('chat'), v.literal('note'), v.literal('manual'))),
    type: v.optional(
      v.union(
        v.literal('preference'),
        v.literal('fact'),
        v.literal('project'),
        v.literal('decision'),
        v.literal('agent'),
      ),
    ),
    importance: v.optional(v.number()),
    projectId: v.optional(v.string()),
    conversationId: v.optional(v.string()),
    noteId: v.optional(v.string()),
    messageId: v.optional(v.string()),
    turnId: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
    actor: v.optional(v.union(v.literal('user'), v.literal('agent'))),
  },
  handler: async (ctx, { userId, accessToken, serverSecret, memoryId, ...updates }) => {
    await authorizeUserAccess({ userId, accessToken, serverSecret })
    const existing = await ctx.db.get(memoryId)
    if (!existing || existing.userId !== userId || existing.deletedAt) {
      throw new Error('Unauthorized')
    }
    const MAX_MEMORY_BYTES = 50 * 1024
    if (updates.content !== undefined && new TextEncoder().encode(updates.content).byteLength > MAX_MEMORY_BYTES) {
      throw new Error(`Memory content exceeds size limit (max ${MAX_MEMORY_BYTES / 1024} KB)`)
    }
    const patch: Record<string, unknown> = { updatedAt: Date.now() }
    if (updates.content !== undefined) patch.content = updates.content
    if (updates.source !== undefined) patch.source = updates.source
    if (updates.type !== undefined) patch.type = updates.type
    if (updates.importance !== undefined) patch.importance = updates.importance
    if (updates.projectId !== undefined) patch.projectId = updates.projectId || undefined
    if (updates.conversationId !== undefined) patch.conversationId = updates.conversationId || undefined
    if (updates.noteId !== undefined) patch.noteId = updates.noteId || undefined
    if (updates.messageId !== undefined) patch.messageId = updates.messageId || undefined
    if (updates.turnId !== undefined) patch.turnId = updates.turnId || undefined
    if (updates.tags !== undefined) patch.tags = updates.tags
    if (updates.actor !== undefined) patch.actor = updates.actor
    await ctx.db.patch(memoryId, patch)
    await ctx.scheduler.runAfter(0, internal.knowledge.knowledge.reindexMemoryInternal, { memoryId })
  },
})

export const remove = mutation({
  args: {
    userId: v.string(),
    accessToken: v.optional(v.string()),
    serverSecret: v.optional(v.string()),
    memoryId: v.id('memories'),
  },
  handler: async (ctx, { userId, accessToken, serverSecret, memoryId }) => {
    await authorizeUserAccess({ userId, accessToken, serverSecret })
    const existing = await ctx.db.get(memoryId)
    if (!existing || existing.userId !== userId || existing.deletedAt) {
      throw new Error('Unauthorized')
    }
    await ctx.runMutation(internal.knowledge.knowledge.purgeKnowledgeSource, {
      sourceKind: 'memory',
      sourceId: memoryId,
      userId,
    })
    await ctx.db.patch(memoryId, {
      deletedAt: Date.now(),
      updatedAt: Date.now(),
    })
  },
})
