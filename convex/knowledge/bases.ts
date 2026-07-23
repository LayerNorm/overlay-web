import { v } from 'convex/values'
import { mutation, query } from '../_generated/server'
import { requireServerSecret } from '../lib/auth'

const baseKind = v.union(v.literal('personal'), v.literal('organization'))
const sourceKind = v.union(v.literal('file'), v.literal('note'), v.literal('memory'), v.literal('text'))
const sourceStatus = v.union(
  v.literal('pending'),
  v.literal('extracting'),
  v.literal('indexing'),
  v.literal('ready'),
  v.literal('failed'),
  v.literal('deleting'),
)

export const createBaseByServer = mutation({
  args: {
    serverSecret: v.string(),
    knowledgeBaseId: v.string(),
    ownerUserId: v.string(),
    title: v.string(),
    description: v.optional(v.string()),
    kind: v.optional(baseKind),
    createdBy: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const existing = await ctx.db.query('knowledgeBases')
      .withIndex('by_knowledgeBaseId', (q) => q.eq('knowledgeBaseId', args.knowledgeBaseId)).unique()
    if (existing) throw new Error('A knowledge base with this ID already exists')
    const now = Date.now()
    const id = await ctx.db.insert('knowledgeBases', {
      knowledgeBaseId: args.knowledgeBaseId,
      ownerUserId: args.ownerUserId,
      title: args.title,
      description: args.description,
      kind: args.kind ?? 'personal',
      status: 'active',
      createdBy: args.createdBy,
      createdAt: now,
      updatedAt: now,
    })
    return await ctx.db.get(id)
  },
})

export const getBaseByServer = query({
  args: { serverSecret: v.string(), knowledgeBaseId: v.string() },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    return await ctx.db.query('knowledgeBases')
      .withIndex('by_knowledgeBaseId', (q) => q.eq('knowledgeBaseId', args.knowledgeBaseId)).unique()
  },
})

export const listBasesForOwnerByServer = query({
  args: { serverSecret: v.string(), ownerUserId: v.string(), includeArchived: v.boolean() },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const rows = await ctx.db.query('knowledgeBases').collect()
    return rows
      .filter((row) => row.ownerUserId === args.ownerUserId && (args.includeArchived || row.status === 'active'))
      .sort((a, b) => b.updatedAt - a.updatedAt || a.knowledgeBaseId.localeCompare(b.knowledgeBaseId))
  },
})

export const updateBaseByServer = mutation({
  args: {
    serverSecret: v.string(),
    knowledgeBaseId: v.string(),
    title: v.optional(v.string()),
    description: v.optional(v.string()),
    kind: v.optional(baseKind),
  },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const existing = await ctx.db.query('knowledgeBases')
      .withIndex('by_knowledgeBaseId', (q) => q.eq('knowledgeBaseId', args.knowledgeBaseId)).unique()
    if (!existing) return null
    const values = {
      ...(args.title !== undefined ? { title: args.title } : {}),
      ...(args.description !== undefined ? { description: args.description } : {}),
      ...(args.kind !== undefined ? { kind: args.kind } : {}),
      updatedAt: Date.now(),
    }
    await ctx.db.patch(existing._id, values)
    return { ...existing, ...values }
  },
})

export const archiveBaseByServer = mutation({
  args: { serverSecret: v.string(), knowledgeBaseId: v.string() },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const existing = await ctx.db.query('knowledgeBases')
      .withIndex('by_knowledgeBaseId', (q) => q.eq('knowledgeBaseId', args.knowledgeBaseId)).unique()
    if (!existing) return { archived: false }
    const now = Date.now()
    await ctx.db.patch(existing._id, { status: 'archived', archivedAt: existing.archivedAt ?? now, updatedAt: now })
    return { archived: true }
  },
})

export const removeBaseByServer = mutation({
  args: { serverSecret: v.string(), knowledgeBaseId: v.string() },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const existing = await ctx.db.query('knowledgeBases')
      .withIndex('by_knowledgeBaseId', (q) => q.eq('knowledgeBaseId', args.knowledgeBaseId)).unique()
    if (!existing) return { removed: false }
    const memberships = await ctx.db.query('knowledgeBaseSources')
      .withIndex('by_knowledgeBaseId', (q) => q.eq('knowledgeBaseId', args.knowledgeBaseId)).collect()
    const conversations = await ctx.db.query('knowledgeBaseConversations')
      .withIndex('by_knowledgeBaseId', (q) => q.eq('knowledgeBaseId', args.knowledgeBaseId)).collect()
    for (const row of [...memberships, ...conversations]) await ctx.db.delete(row._id)
    await ctx.db.delete(existing._id)
    return { removed: true }
  },
})

export const createSourceByServer = mutation({
  args: {
    serverSecret: v.string(),
    sourceId: v.string(),
    ownerUserId: v.string(),
    kind: sourceKind,
    sourceRef: v.optional(v.string()),
    title: v.string(),
    mimeType: v.optional(v.string()),
    contentHash: v.optional(v.string()),
    status: v.optional(sourceStatus),
    statusMessage: v.optional(v.string()),
    metadata: v.optional(v.any()),
    createdBy: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const existing = await ctx.db.query('knowledgeSources')
      .withIndex('by_sourceId', (q) => q.eq('sourceId', args.sourceId)).unique()
    if (existing) throw new Error('A knowledge source with this ID already exists')
    if (args.sourceRef) {
      const candidates = await ctx.db.query('knowledgeSources')
        .withIndex('by_owner_kind_ref', (q) => q
          .eq('ownerUserId', args.ownerUserId)
          .eq('kind', args.kind)
          .eq('sourceRef', args.sourceRef))
        .collect()
      const duplicate = candidates.find((row) => row.deletedAt === undefined)
      if (duplicate) throw new Error('This source is already registered')
    }
    const now = Date.now()
    const id = await ctx.db.insert('knowledgeSources', {
      sourceId: args.sourceId,
      ownerUserId: args.ownerUserId,
      kind: args.kind,
      sourceRef: args.sourceRef,
      title: args.title,
      mimeType: args.mimeType,
      contentHash: args.contentHash,
      status: args.status ?? 'pending',
      statusMessage: args.statusMessage,
      metadata: args.metadata ?? {},
      createdBy: args.createdBy,
      createdAt: now,
      updatedAt: now,
    })
    return await ctx.db.get(id)
  },
})

export const getSourceByServer = query({
  args: { serverSecret: v.string(), sourceId: v.string() },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const row = await ctx.db.query('knowledgeSources')
      .withIndex('by_sourceId', (q) => q.eq('sourceId', args.sourceId)).unique()
    return row?.deletedAt === undefined ? row : null
  },
})

export const updateSourceByServer = mutation({
  args: {
    serverSecret: v.string(),
    sourceId: v.string(),
    title: v.optional(v.string()),
    mimeType: v.optional(v.string()),
    contentHash: v.optional(v.string()),
    status: v.optional(sourceStatus),
    statusMessage: v.optional(v.string()),
    metadata: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const existing = await ctx.db.query('knowledgeSources')
      .withIndex('by_sourceId', (q) => q.eq('sourceId', args.sourceId)).unique()
    if (!existing || existing.deletedAt !== undefined) return null
    const values = {
      ...(args.title !== undefined ? { title: args.title } : {}),
      ...(args.mimeType !== undefined ? { mimeType: args.mimeType } : {}),
      ...(args.contentHash !== undefined ? { contentHash: args.contentHash } : {}),
      ...(args.status !== undefined ? { status: args.status } : {}),
      ...(args.statusMessage !== undefined ? { statusMessage: args.statusMessage } : {}),
      ...(args.metadata !== undefined ? { metadata: args.metadata } : {}),
      updatedAt: Date.now(),
    }
    await ctx.db.patch(existing._id, values)
    return { ...existing, ...values }
  },
})

export const markSourceDeletedByServer = mutation({
  args: { serverSecret: v.string(), sourceId: v.string() },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const existing = await ctx.db.query('knowledgeSources')
      .withIndex('by_sourceId', (q) => q.eq('sourceId', args.sourceId)).unique()
    if (!existing || existing.deletedAt !== undefined) return { removed: false }
    const now = Date.now()
    await ctx.db.patch(existing._id, { status: 'deleting', deletedAt: now, updatedAt: now })
    return { removed: true }
  },
})

export const createSourceVersionByServer = mutation({
  args: {
    serverSecret: v.string(),
    sourceVersionId: v.string(),
    sourceId: v.string(),
    version: v.number(),
    contentHash: v.string(),
    status: sourceStatus,
    metadata: v.any(),
  },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const duplicate = await ctx.db.query('knowledgeSourceVersions')
      .withIndex('by_sourceId_contentHash', (q) => q.eq('sourceId', args.sourceId).eq('contentHash', args.contentHash))
      .unique()
    const now = Date.now()
    if (duplicate) {
      await ctx.db.patch(duplicate._id, { status: args.status, metadata: args.metadata, updatedAt: now })
      return { ...duplicate, status: args.status, metadata: args.metadata, updatedAt: now }
    }
    const id = await ctx.db.insert('knowledgeSourceVersions', {
      sourceVersionId: args.sourceVersionId,
      sourceId: args.sourceId,
      version: args.version,
      contentHash: args.contentHash,
      status: args.status,
      metadata: args.metadata,
      createdAt: now,
      updatedAt: now,
    })
    return await ctx.db.get(id)
  },
})

export const listSourceVersionsByServer = query({
  args: { serverSecret: v.string(), sourceId: v.string() },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    return await ctx.db.query('knowledgeSourceVersions')
      .withIndex('by_sourceId_version', (q) => q.eq('sourceId', args.sourceId))
      .order('desc').collect()
  },
})

export const addSourceToBaseByServer = mutation({
  args: {
    serverSecret: v.string(),
    knowledgeBaseId: v.string(),
    sourceId: v.string(),
    addedBy: v.optional(v.string()),
    enabled: v.boolean(),
  },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const existing = await ctx.db.query('knowledgeBaseSources')
      .withIndex('by_base_source', (q) => q.eq('knowledgeBaseId', args.knowledgeBaseId).eq('sourceId', args.sourceId))
      .unique()
    if (existing) {
      await ctx.db.patch(existing._id, { addedBy: args.addedBy, enabled: args.enabled })
      return { ...existing, addedBy: args.addedBy, enabled: args.enabled }
    }
    const id = await ctx.db.insert('knowledgeBaseSources', {
      knowledgeBaseId: args.knowledgeBaseId,
      sourceId: args.sourceId,
      addedBy: args.addedBy,
      enabled: args.enabled,
      createdAt: Date.now(),
    })
    return await ctx.db.get(id)
  },
})

export const removeSourceFromBaseByServer = mutation({
  args: { serverSecret: v.string(), knowledgeBaseId: v.string(), sourceId: v.string() },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const existing = await ctx.db.query('knowledgeBaseSources')
      .withIndex('by_base_source', (q) => q.eq('knowledgeBaseId', args.knowledgeBaseId).eq('sourceId', args.sourceId))
      .unique()
    if (!existing) return { removed: false }
    await ctx.db.delete(existing._id)
    return { removed: true }
  },
})

export const setBaseSourceEnabledByServer = mutation({
  args: { serverSecret: v.string(), knowledgeBaseId: v.string(), sourceId: v.string(), enabled: v.boolean() },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const existing = await ctx.db.query('knowledgeBaseSources')
      .withIndex('by_base_source', (q) => q.eq('knowledgeBaseId', args.knowledgeBaseId).eq('sourceId', args.sourceId))
      .unique()
    if (!existing) return { updated: false }
    await ctx.db.patch(existing._id, { enabled: args.enabled })
    return { updated: true }
  },
})

export const listSourcesForBaseByServer = query({
  args: { serverSecret: v.string(), knowledgeBaseId: v.string() },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    return await ctx.db.query('knowledgeBaseSources')
      .withIndex('by_knowledgeBaseId', (q) => q.eq('knowledgeBaseId', args.knowledgeBaseId)).collect()
  },
})

export const listBasesForSourceByServer = query({
  args: { serverSecret: v.string(), sourceId: v.string() },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    return await ctx.db.query('knowledgeBaseSources')
      .withIndex('by_sourceId', (q) => q.eq('sourceId', args.sourceId)).collect()
  },
})

export const attachConversationByServer = mutation({
  args: {
    serverSecret: v.string(),
    knowledgeBaseId: v.string(),
    conversationId: v.string(),
    createdBy: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const existing = await ctx.db.query('knowledgeBaseConversations')
      .withIndex('by_conversationId', (q) => q.eq('conversationId', args.conversationId)).unique()
    if (existing) {
      await ctx.db.patch(existing._id, { knowledgeBaseId: args.knowledgeBaseId, createdBy: args.createdBy })
      return { ...existing, knowledgeBaseId: args.knowledgeBaseId, createdBy: args.createdBy }
    }
    const id = await ctx.db.insert('knowledgeBaseConversations', {
      knowledgeBaseId: args.knowledgeBaseId,
      conversationId: args.conversationId,
      createdBy: args.createdBy,
      createdAt: Date.now(),
    })
    return await ctx.db.get(id)
  },
})

export const detachConversationByServer = mutation({
  args: { serverSecret: v.string(), conversationId: v.string() },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const existing = await ctx.db.query('knowledgeBaseConversations')
      .withIndex('by_conversationId', (q) => q.eq('conversationId', args.conversationId)).unique()
    if (!existing) return { removed: false }
    await ctx.db.delete(existing._id)
    return { removed: true }
  },
})

export const getConversationBaseByServer = query({
  args: { serverSecret: v.string(), conversationId: v.string() },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    return await ctx.db.query('knowledgeBaseConversations')
      .withIndex('by_conversationId', (q) => q.eq('conversationId', args.conversationId)).unique()
  },
})

export const listConversationsForBaseByServer = query({
  args: { serverSecret: v.string(), knowledgeBaseId: v.string() },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    return await ctx.db.query('knowledgeBaseConversations')
      .withIndex('by_knowledgeBaseId', (q) => q.eq('knowledgeBaseId', args.knowledgeBaseId)).collect()
  },
})

export const purgeOwnerDataByServer = mutation({
  args: { serverSecret: v.string(), ownerUserId: v.string() },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const bases = await ctx.db.query('knowledgeBases').collect()
    const ownedBases = bases.filter((row) => row.ownerUserId === args.ownerUserId)
    const baseIds = new Set(ownedBases.map((row) => row.knowledgeBaseId))
    const sources = await ctx.db.query('knowledgeSources').collect()
    const ownedSources = sources.filter((row) => row.ownerUserId === args.ownerUserId)
    const sourceIds = new Set(ownedSources.map((row) => row.sourceId))

    const memberships = await ctx.db.query('knowledgeBaseSources').collect()
    for (const row of memberships) {
      if (baseIds.has(row.knowledgeBaseId) || sourceIds.has(row.sourceId)) await ctx.db.delete(row._id)
    }
    const conversations = await ctx.db.query('knowledgeBaseConversations').collect()
    for (const row of conversations) {
      if (baseIds.has(row.knowledgeBaseId)) await ctx.db.delete(row._id)
    }
    const versions = await ctx.db.query('knowledgeSourceVersions').collect()
    for (const row of versions) {
      if (sourceIds.has(row.sourceId)) await ctx.db.delete(row._id)
    }
    for (const row of ownedSources) await ctx.db.delete(row._id)
    for (const row of ownedBases) await ctx.db.delete(row._id)

    return { removedBases: ownedBases.length, removedSources: ownedSources.length }
  },
})
