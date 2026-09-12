import { v } from 'convex/values'
import { mutation, query } from '../_generated/server'
import { requireServerSecret } from '../lib/auth'

// Server-only surface: the BFF reaches these through ConvexComputerRepository
// with the internal server secret. Authorization lives in ComputerService.

const ownerType = v.union(v.literal('agent'), v.literal('user'))
const size = v.union(v.literal('small'), v.literal('default'), v.literal('large'))
const status = v.union(
  v.literal('provisioning'),
  v.literal('ready'),
  v.literal('stopped'),
  v.literal('error'),
)

export const create = mutation({
  args: {
    id: v.string(),
    serverSecret: v.string(),
    workspaceId: v.string(),
    ownerType,
    ownerId: v.string(),
    provider: v.string(),
    providerRef: v.optional(v.string()),
    size,
    status,
    name: v.optional(v.string()),
    createdBy: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
    lastActiveAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const existing = await ctx.db
      .query('computers')
      .withIndex('by_workspaceId_owner', (q) => q
        .eq('workspaceId', args.workspaceId)
        .eq('ownerType', args.ownerType)
        .eq('ownerId', args.ownerId))
      .unique()
    // Mutations are transactional, so the check-then-insert is atomic; a hit
    // means the owner binding already exists — return it idempotently.
    if (existing) return existing.id
    await ctx.db.insert('computers', {
      id: args.id,
      workspaceId: args.workspaceId,
      ownerType: args.ownerType,
      ownerId: args.ownerId,
      provider: args.provider,
      providerRef: args.providerRef,
      size: args.size,
      status: args.status,
      name: args.name,
      createdBy: args.createdBy,
      createdAt: args.createdAt,
      updatedAt: args.updatedAt,
      lastActiveAt: args.lastActiveAt,
    })
    return args.id
  },
})

export const get = query({
  args: { id: v.string(), serverSecret: v.string() },
  handler: async (ctx, { id, serverSecret }) => {
    requireServerSecret(serverSecret)
    return await ctx.db
      .query('computers')
      .withIndex('by_entityId', (q) => q.eq('id', id))
      .unique()
  },
})

export const findByOwner = query({
  args: {
    workspaceId: v.string(),
    ownerType,
    ownerId: v.string(),
    serverSecret: v.string(),
  },
  handler: async (ctx, { workspaceId, ownerType, ownerId, serverSecret }) => {
    requireServerSecret(serverSecret)
    return await ctx.db
      .query('computers')
      .withIndex('by_workspaceId_owner', (q) => q
        .eq('workspaceId', workspaceId)
        .eq('ownerType', ownerType)
        .eq('ownerId', ownerId))
      .unique()
  },
})

export const listByWorkspace = query({
  args: { workspaceId: v.string(), serverSecret: v.string() },
  handler: async (ctx, { workspaceId, serverSecret }) => {
    requireServerSecret(serverSecret)
    const rows = await ctx.db
      .query('computers')
      .withIndex('by_workspaceId', (q) => q.eq('workspaceId', workspaceId))
      .collect()
    return rows.sort((a, b) => a.createdAt - b.createdAt)
  },
})

export const update = mutation({
  args: {
    id: v.string(),
    serverSecret: v.string(),
    provider: v.optional(v.string()),
    providerRef: v.optional(v.union(v.string(), v.null())),
    size: v.optional(size),
    status: v.optional(status),
    name: v.optional(v.union(v.string(), v.null())),
    updatedAt: v.optional(v.number()),
    lastActiveAt: v.optional(v.union(v.number(), v.null())),
  },
  handler: async (ctx, { id, serverSecret, updatedAt, ...patch }) => {
    requireServerSecret(serverSecret)
    const doc = await ctx.db
      .query('computers')
      .withIndex('by_entityId', (q) => q.eq('id', id))
      .unique()
    if (!doc) throw new Error('Computer not found')
    const fields: Record<string, unknown> = { updatedAt: updatedAt ?? Date.now() }
    if (patch.provider !== undefined) fields.provider = patch.provider
    if (patch.providerRef !== undefined) fields.providerRef = patch.providerRef ?? undefined
    if (patch.size !== undefined) fields.size = patch.size
    if (patch.status !== undefined) fields.status = patch.status
    if (patch.name !== undefined) fields.name = patch.name ?? undefined
    if (patch.lastActiveAt !== undefined) fields.lastActiveAt = patch.lastActiveAt ?? undefined
    await ctx.db.patch(doc._id, fields)
    return doc.id
  },
})

export const remove = mutation({
  args: { id: v.string(), serverSecret: v.string() },
  handler: async (ctx, { id, serverSecret }) => {
    requireServerSecret(serverSecret)
    const doc = await ctx.db
      .query('computers')
      .withIndex('by_entityId', (q) => q.eq('id', id))
      .unique()
    if (doc) await ctx.db.delete(doc._id)
  },
})
