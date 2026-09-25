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

const memoryDocValidator = v.object({
  _creationTime: v.number(),
  _id: v.id('memories'),
  actor: v.optional(v.union(v.literal('user'), v.literal('agent'))),
  clientId: v.optional(v.string()),
  content: v.string(),
  conversationId: v.optional(v.string()),
  createdAt: v.number(),
  deletedAt: v.optional(v.number()),
  eventAt: v.optional(v.number()),
  expiresAt: v.optional(v.number()),
  importance: v.optional(v.number()),
  messageId: v.optional(v.string()),
  noteId: v.optional(v.string()),
  source: v.union(v.literal('chat'), v.literal('note'), v.literal('manual')),
  supersededAt: v.optional(v.number()),
  supersededBy: v.optional(v.id('memories')),
  tags: v.optional(v.array(v.string())),
  turnId: v.optional(v.string()),
  visibility: v.optional(v.union(v.literal('owner'), v.literal('workspace'))),
  type: v.optional(v.union(
    v.literal('preference'),
    v.literal('fact'),
    v.literal('project'),
    v.literal('decision'),
    v.literal('agent'),
  )),
  updatedAt: v.number(),
  userId: v.string(),
  workspaceId: v.optional(v.string()),
})

export const list = query({
  args: {
    userId: v.string(),
    workspaceId: v.optional(v.string()),
    accessToken: v.optional(v.string()),
    serverSecret: v.optional(v.string()),
    updatedSince: v.optional(v.number()),
    includeDeleted: v.optional(v.boolean()),
    conversationId: v.optional(v.string()),
    noteId: v.optional(v.string()),
  },
  handler: async (ctx, { userId, workspaceId, accessToken, serverSecret, updatedSince, includeDeleted, conversationId, noteId }) => {
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
      .filter((memory) => (conversationId !== undefined ? memory.conversationId === conversationId : true))
      .filter((memory) => (noteId !== undefined ? memory.noteId === noteId : true))
      .filter((memory) => (workspaceId !== undefined ? memory.workspaceId === workspaceId : true))
  },
})

export const listWorkspace = query({
  args: {
    workspaceId: v.string(),
    creatorUserId: v.optional(v.string()),
    serverSecret: v.string(),
    updatedSince: v.optional(v.number()),
    includeDeleted: v.optional(v.boolean()),
    conversationId: v.optional(v.string()),
    noteId: v.optional(v.string()),
  },
  returns: v.array(memoryDocValidator),
  handler: async (ctx, {
    workspaceId,
    creatorUserId,
    serverSecret,
    updatedSince,
    includeDeleted,
    conversationId,
    noteId,
  }) => {
    if (!validateServerSecret(serverSecret)) return []
    const memories = creatorUserId
      ? await ctx.db
          .query('memories')
          .withIndex('by_workspaceId_userId', (q) => q.eq('workspaceId', workspaceId).eq('userId', creatorUserId))
          .order('desc')
          .take(100)
      : await ctx.db
          .query('memories')
          .withIndex('by_workspaceId', (q) => q.eq('workspaceId', workspaceId))
          .order('desc')
          .take(100)
    return memories
      .map(normalizeMemoryDoc)
      .filter((memory) => (updatedSince !== undefined ? memory.updatedAt > updatedSince : true))
      .filter((memory) => (includeDeleted ? true : !memory.deletedAt))
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
    conversationId: v.optional(v.string()),
    noteId: v.optional(v.string()),
    messageId: v.optional(v.string()),
    turnId: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
    actor: v.optional(v.union(v.literal('user'), v.literal('agent'))),
    expiresAt: v.optional(v.number()),
    eventAt: v.optional(v.number()),
    visibility: v.optional(v.union(v.literal('owner'), v.literal('workspace'))),
  },
  handler: async (ctx, args) => {
    await authorizeUserAccess(args)
    const MAX_MEMORY_BYTES = 50 * 1024 // 50 KB
    if (new TextEncoder().encode(args.content).byteLength > MAX_MEMORY_BYTES) {
      throw new Error(`Memory content exceeds size limit (max ${MAX_MEMORY_BYTES / 1024} KB)`)
    }
    if (args.clientId?.trim()) {
      const existing = args.workspaceId
        ? await ctx.db
            .query('memories')
            .withIndex('by_workspaceId_userId', (q) => q
              .eq('workspaceId', args.workspaceId)
              .eq('userId', args.userId))
            .filter((q) => q.eq(q.field('clientId'), args.clientId!.trim()))
            .first()
        : await ctx.db
            .query('memories')
            .withIndex('by_userId_clientId', (q) => q.eq('userId', args.userId).eq('clientId', args.clientId!.trim()))
            .filter((q) => q.eq(q.field('workspaceId'), undefined))
            .first()
      if (existing) {
        return existing._id
      }
    }

    // Deduplication: exact / near-exact content match for non-clientId inserts
    if (!args.clientId?.trim()) {
      const normalized = args.content.toLowerCase().replace(/\s+/g, ' ').trim()
      const candidates = args.workspaceId
        ? await ctx.db
            .query('memories')
            .withIndex('by_workspaceId_userId', (q) => q.eq('workspaceId', args.workspaceId).eq('userId', args.userId))
            .take(100)
        : await ctx.db
            .query('memories')
            .withIndex('by_userId', (q) => q.eq('userId', args.userId))
            .filter((q) => q.eq(q.field('workspaceId'), undefined))
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
      conversationId: args.conversationId,
      noteId: args.noteId,
      messageId: args.messageId,
      turnId: args.turnId,
      tags: args.tags,
      actor: args.actor,
      expiresAt: args.expiresAt,
      eventAt: args.eventAt,
      visibility: args.visibility,
      createdAt: now,
      updatedAt: now,
    })
    await ctx.scheduler.runAfter(0, internal.knowledge.knowledge.reindexMemoryInternal, {
      memoryId,
      trustedInternal: validateServerSecret(args.serverSecret),
    })
    return memoryId
  },
})

export const update = mutation({
  args: {
    userId: v.string(),
    workspaceId: v.optional(v.string()),
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
    conversationId: v.optional(v.string()),
    noteId: v.optional(v.string()),
    messageId: v.optional(v.string()),
    turnId: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
    actor: v.optional(v.union(v.literal('user'), v.literal('agent'))),
    expiresAt: v.optional(v.number()),
    eventAt: v.optional(v.number()),
    visibility: v.optional(v.union(v.literal('owner'), v.literal('workspace'))),
  },
  handler: async (ctx, { userId, workspaceId, accessToken, serverSecret, memoryId, ...updates }) => {
    await authorizeUserAccess({ userId, accessToken, serverSecret })
    const existing = await ctx.db.get(memoryId)
    if (!existing || existing.userId !== userId || existing.deletedAt || (workspaceId !== undefined && existing.workspaceId !== workspaceId)) {
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
    if (updates.conversationId !== undefined) patch.conversationId = updates.conversationId || undefined
    if (updates.noteId !== undefined) patch.noteId = updates.noteId || undefined
    if (updates.messageId !== undefined) patch.messageId = updates.messageId || undefined
    if (updates.turnId !== undefined) patch.turnId = updates.turnId || undefined
    if (updates.tags !== undefined) patch.tags = updates.tags
    if (updates.actor !== undefined) patch.actor = updates.actor
    if (updates.expiresAt !== undefined) patch.expiresAt = updates.expiresAt
    if (updates.eventAt !== undefined) patch.eventAt = updates.eventAt
    if (updates.visibility !== undefined) patch.visibility = updates.visibility
    await ctx.db.patch(memoryId, patch)
    await ctx.scheduler.runAfter(0, internal.knowledge.knowledge.reindexMemoryInternal, {
      memoryId,
      trustedInternal: validateServerSecret(serverSecret),
    })
  },
})

export const remove = mutation({
  args: {
    userId: v.string(),
    workspaceId: v.optional(v.string()),
    accessToken: v.optional(v.string()),
    serverSecret: v.optional(v.string()),
    memoryId: v.id('memories'),
  },
  handler: async (ctx, { userId, workspaceId, accessToken, serverSecret, memoryId }) => {
    await authorizeUserAccess({ userId, accessToken, serverSecret })
    const existing = await ctx.db.get(memoryId)
    if (!existing || existing.userId !== userId || existing.deletedAt || (workspaceId !== undefined && existing.workspaceId !== workspaceId)) {
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

/**
 * Freshness bump for semantic duplicates: the fact is unchanged, only its
 * recency signal moves. No reindex — content is identical — but the
 * denormalized chunk `updatedAt` moves too so recency decay honors it.
 */
export const touch = mutation({
  args: {
    userId: v.string(),
    workspaceId: v.optional(v.string()),
    accessToken: v.optional(v.string()),
    serverSecret: v.optional(v.string()),
    memoryId: v.id('memories'),
  },
  handler: async (ctx, { userId, workspaceId, accessToken, serverSecret, memoryId }) => {
    await authorizeUserAccess({ userId, accessToken, serverSecret })
    const existing = await ctx.db.get(memoryId)
    if (!existing || existing.userId !== userId || existing.deletedAt || (workspaceId !== undefined && existing.workspaceId !== workspaceId)) {
      throw new Error('Unauthorized')
    }
    const now = Date.now()
    await ctx.db.patch(memoryId, { updatedAt: now })
    const chunks = await ctx.db
      .query('knowledgeChunks')
      .withIndex('by_source', (q) => q.eq('sourceKind', 'memory').eq('sourceId', memoryId))
      .collect()
    for (const chunk of chunks) {
      await ctx.db.patch(chunk._id, { updatedAt: now })
    }
  },
})

/**
 * Factual replacement: insert the new row and mark the old one superseded.
 * The old row stays in the table for audit but its chunks are flagged
 * `superseded` so retrieval drops them without a join.
 */
export const supersede = mutation({
  args: {
    userId: v.string(),
    workspaceId: v.optional(v.string()),
    accessToken: v.optional(v.string()),
    serverSecret: v.optional(v.string()),
    memoryId: v.id('memories'),
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
    conversationId: v.optional(v.string()),
    noteId: v.optional(v.string()),
    messageId: v.optional(v.string()),
    turnId: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
    actor: v.optional(v.union(v.literal('user'), v.literal('agent'))),
    expiresAt: v.optional(v.number()),
    eventAt: v.optional(v.number()),
    visibility: v.optional(v.union(v.literal('owner'), v.literal('workspace'))),
  },
  handler: async (ctx, args) => {
    await authorizeUserAccess(args)
    const old = await ctx.db.get(args.memoryId)
    if (!old || old.userId !== args.userId || old.deletedAt || (args.workspaceId !== undefined && old.workspaceId !== args.workspaceId)) {
      throw new Error('Unauthorized')
    }
    const MAX_MEMORY_BYTES = 50 * 1024
    if (new TextEncoder().encode(args.content).byteLength > MAX_MEMORY_BYTES) {
      throw new Error(`Memory content exceeds size limit (max ${MAX_MEMORY_BYTES / 1024} KB)`)
    }
    const now = Date.now()
    const newId = await ctx.db.insert('memories', {
      userId: args.userId,
      workspaceId: old.workspaceId,
      content: args.content,
      source: args.source,
      type: args.type ?? old.type,
      importance: args.importance ?? old.importance,
      conversationId: args.conversationId ?? old.conversationId,
      noteId: args.noteId ?? old.noteId,
      messageId: args.messageId,
      turnId: args.turnId,
      tags: args.tags ?? old.tags,
      actor: args.actor ?? old.actor,
      expiresAt: args.expiresAt,
      eventAt: args.eventAt,
      visibility: args.visibility ?? old.visibility,
      createdAt: now,
      updatedAt: now,
    })
    await ctx.db.patch(old._id, {
      supersededBy: newId,
      supersededAt: now,
      updatedAt: now,
    })
    const oldChunks = await ctx.db
      .query('knowledgeChunks')
      .withIndex('by_source', (q) => q.eq('sourceKind', 'memory').eq('sourceId', old._id))
      .collect()
    for (const chunk of oldChunks) {
      await ctx.db.patch(chunk._id, { superseded: true })
    }
    await ctx.scheduler.runAfter(0, internal.knowledge.knowledge.reindexMemoryInternal, {
      memoryId: newId,
      trustedInternal: validateServerSecret(args.serverSecret),
    })
    return newId
  },
})

/**
 * Fetch specific memory rows by id (owner-scoped, live rows only). Used by the
 * extractor's dedup decision to read the memories behind retrieved chunks —
 * `list` caps at 100 rows and can't page by id.
 */
export const getByIds = query({
  args: {
    userId: v.string(),
    memoryIds: v.array(v.id('memories')),
    accessToken: v.optional(v.string()),
    serverSecret: v.optional(v.string()),
    includeDeleted: v.optional(v.boolean()),
  },
  returns: v.array(memoryDocValidator),
  handler: async (ctx, { userId, memoryIds, accessToken, serverSecret, includeDeleted }) => {
    try {
      await authorizeUserAccess({ userId, accessToken, serverSecret })
    } catch {
      return []
    }
    const out = []
    for (const id of memoryIds.slice(0, 50)) {
      const m = await ctx.db.get(id)
      if (m && m.userId === userId && (includeDeleted || !m.deletedAt)) out.push(normalizeMemoryDoc(m))
    }
    return out
  },
})
