import { v } from 'convex/values'
import { mutation, query } from '../_generated/server'
import type { MutationCtx } from '../_generated/server'
import { requireServerSecret } from '../lib/auth'

const apiKeyScope = v.union(
  v.literal('chat:read'),
  v.literal('chat:write'),
  v.literal('files:read'),
  v.literal('files:write'),
  v.literal('admin'),
)

const apiKeyRecord = v.object({
  id: v.id('apiKeys'),
  name: v.optional(v.string()),
  userId: v.string(),
  scopes: v.array(apiKeyScope),
  expiresAt: v.number(),
  createdAt: v.number(),
  createdBy: v.optional(v.string()),
  createdFromIp: v.optional(v.string()),
  lastUsedAt: v.optional(v.number()),
  lastUsedIp: v.optional(v.string()),
  revokedAt: v.optional(v.number()),
  revokedReason: v.optional(v.string()),
})

function isExpired(expiresAt: number, now: number): boolean {
  return expiresAt <= now
}

async function assertHashIsUnused(ctx: MutationCtx, keyHash: string): Promise<void> {
  const existing = await ctx.db
    .query('apiKeys')
    .withIndex('by_keyHash', (q) => q.eq('keyHash', keyHash))
    .unique()
  if (existing) {
    throw new Error('API key hash already exists')
  }
}

export const createByServer = mutation({
  args: {
    serverSecret: v.string(),
    keyHash: v.string(),
    name: v.optional(v.string()),
    userId: v.string(),
    scopes: v.array(apiKeyScope),
    expiresAt: v.number(),
    createdAt: v.number(),
    createdBy: v.optional(v.string()),
    createdFromIp: v.optional(v.string()),
  },
  returns: apiKeyRecord,
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    await assertHashIsUnused(ctx, args.keyHash)

    const now = Date.now()
    if (isExpired(args.expiresAt, now)) {
      throw new Error('API key expiresAt must be in the future')
    }

    const id = await ctx.db.insert('apiKeys', {
      keyHash: args.keyHash,
      name: args.name,
      userId: args.userId,
      scopes: args.scopes,
      expiresAt: args.expiresAt,
      createdAt: args.createdAt,
      createdBy: args.createdBy,
      createdFromIp: args.createdFromIp,
    })

    return {
      id,
      name: args.name,
      userId: args.userId,
      scopes: args.scopes,
      expiresAt: args.expiresAt,
      createdAt: args.createdAt,
      createdBy: args.createdBy,
      createdFromIp: args.createdFromIp,
    }
  },
})

export const listByUserByServer = query({
  args: {
    serverSecret: v.string(),
    userId: v.string(),
  },
  returns: v.array(apiKeyRecord),
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const rows = await ctx.db
      .query('apiKeys')
      .withIndex('by_userId_createdAt', (q) => q.eq('userId', args.userId))
      .order('desc')
      .collect()
    return rows.map((row) => ({
      id: row._id,
      name: row.name,
      userId: row.userId,
      scopes: row.scopes,
      expiresAt: row.expiresAt,
      createdAt: row.createdAt,
      createdBy: row.createdBy,
      createdFromIp: row.createdFromIp,
      lastUsedAt: row.lastUsedAt,
      lastUsedIp: row.lastUsedIp,
      revokedAt: row.revokedAt,
      revokedReason: row.revokedReason,
    }))
  },
})

export const validateByServer = mutation({
  args: {
    serverSecret: v.string(),
    keyHash: v.string(),
    lastUsedAt: v.number(),
    lastUsedIp: v.optional(v.string()),
    now: v.optional(v.number()),
  },
  returns: v.union(apiKeyRecord, v.null()),
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)

    const row = await ctx.db
      .query('apiKeys')
      .withIndex('by_keyHash', (q) => q.eq('keyHash', args.keyHash))
      .unique()
    const now = args.now ?? Date.now()
    if (!row || row.revokedAt || isExpired(row.expiresAt, now)) return null

    if (
      !row.lastUsedAt ||
      row.lastUsedAt < now - 60_000 ||
      row.lastUsedIp !== args.lastUsedIp
    ) {
      await ctx.db.patch(row._id, {
        lastUsedAt: args.lastUsedAt,
        lastUsedIp: args.lastUsedIp,
      })
    }

    return {
      id: row._id,
      name: row.name,
      userId: row.userId,
      scopes: row.scopes,
      expiresAt: row.expiresAt,
      createdAt: row.createdAt,
      createdBy: row.createdBy,
      createdFromIp: row.createdFromIp,
      lastUsedAt: args.lastUsedAt,
      lastUsedIp: args.lastUsedIp,
    }
  },
})

export const revokeByServer = mutation({
  args: {
    serverSecret: v.string(),
    keyHash: v.string(),
    revokedAt: v.number(),
    revokedReason: v.optional(v.string()),
    userId: v.optional(v.string()),
  },
  returns: v.object({ revoked: v.boolean() }),
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)

    const row = await ctx.db
      .query('apiKeys')
      .withIndex('by_keyHash', (q) => q.eq('keyHash', args.keyHash))
      .unique()
    if (!row || (args.userId && row.userId !== args.userId)) {
      return { revoked: false }
    }
    if (row.revokedAt) return { revoked: true }

    await ctx.db.patch(row._id, {
      revokedAt: args.revokedAt,
      revokedReason: args.revokedReason,
    })
    return { revoked: true }
  },
})

export const revokeByIdByServer = mutation({
  args: {
    serverSecret: v.string(),
    id: v.id('apiKeys'),
    userId: v.string(),
    revokedAt: v.number(),
    revokedReason: v.optional(v.string()),
  },
  returns: v.object({ revoked: v.boolean() }),
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const row = await ctx.db.get(args.id)
    if (!row || row.userId !== args.userId) return { revoked: false }
    if (!row.revokedAt) {
      await ctx.db.patch(row._id, {
        revokedAt: args.revokedAt,
        revokedReason: args.revokedReason,
      })
    }
    return { revoked: true }
  },
})

export const rotateByIdByServer = mutation({
  args: {
    serverSecret: v.string(),
    id: v.id('apiKeys'),
    keyHash: v.string(),
    name: v.optional(v.string()),
    userId: v.string(),
    scopes: v.array(apiKeyScope),
    expiresAt: v.number(),
    createdAt: v.number(),
    createdBy: v.optional(v.string()),
    createdFromIp: v.optional(v.string()),
    revokedReason: v.string(),
  },
  returns: v.union(apiKeyRecord, v.null()),
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const existing = await ctx.db.get(args.id)
    if (!existing || existing.userId !== args.userId || existing.revokedAt || isExpired(existing.expiresAt, args.createdAt)) {
      return null
    }
    if (isExpired(args.expiresAt, args.createdAt)) throw new Error('API key expiresAt must be in the future')
    await assertHashIsUnused(ctx, args.keyHash)
    await ctx.db.patch(existing._id, {
      revokedAt: args.createdAt,
      revokedReason: args.revokedReason,
    })
    const id = await ctx.db.insert('apiKeys', {
      keyHash: args.keyHash,
      name: args.name,
      userId: args.userId,
      scopes: args.scopes,
      expiresAt: args.expiresAt,
      createdAt: args.createdAt,
      createdBy: args.createdBy,
      createdFromIp: args.createdFromIp,
    })
    return {
      id,
      name: args.name,
      userId: args.userId,
      scopes: args.scopes,
      expiresAt: args.expiresAt,
      createdAt: args.createdAt,
      createdBy: args.createdBy,
      createdFromIp: args.createdFromIp,
    }
  },
})

export const rotateByServer = mutation({
  args: {
    serverSecret: v.string(),
    oldKeyHash: v.string(),
    newKeyHash: v.string(),
    name: v.optional(v.string()),
    userId: v.string(),
    scopes: v.array(apiKeyScope),
    expiresAt: v.number(),
    createdBy: v.optional(v.string()),
    createdFromIp: v.optional(v.string()),
    revokedAt: v.number(),
    revokedReason: v.string(),
    now: v.optional(v.number()),
  },
  returns: v.union(apiKeyRecord, v.null()),
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)

    const now = args.now ?? Date.now()
    const existing = await ctx.db
      .query('apiKeys')
      .withIndex('by_keyHash', (q) => q.eq('keyHash', args.oldKeyHash))
      .unique()
    if (!existing || existing.userId !== args.userId || existing.revokedAt || isExpired(existing.expiresAt, now)) {
      return null
    }
    if (isExpired(args.expiresAt, now)) {
      throw new Error('API key expiresAt must be in the future')
    }
    await assertHashIsUnused(ctx, args.newKeyHash)

    await ctx.db.patch(existing._id, {
      revokedAt: args.revokedAt,
      revokedReason: args.revokedReason,
    })
    const createdAt = now
    const id = await ctx.db.insert('apiKeys', {
      keyHash: args.newKeyHash,
      name: args.name,
      userId: args.userId,
      scopes: args.scopes,
      expiresAt: args.expiresAt,
      createdAt,
      createdBy: args.createdBy,
      createdFromIp: args.createdFromIp,
    })

    return {
      id,
      name: args.name,
      userId: args.userId,
      scopes: args.scopes,
      expiresAt: args.expiresAt,
      createdAt,
      createdBy: args.createdBy,
      createdFromIp: args.createdFromIp,
    }
  },
})

export const cleanupExpiredByServer = mutation({
  args: {
    serverSecret: v.string(),
    now: v.optional(v.number()),
    limit: v.optional(v.number()),
  },
  returns: v.object({ revoked: v.number() }),
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const now = args.now ?? Date.now()
    const limit = Math.min(Math.max(args.limit ?? 500, 1), 2000)
    const expired = await ctx.db
      .query('apiKeys')
      .withIndex('by_expiresAt', (q) => q.lt('expiresAt', now))
      .take(limit)

    let revoked = 0
    for (const row of expired) {
      if (row.revokedAt) continue
      await ctx.db.patch(row._id, {
        revokedAt: row.expiresAt,
        revokedReason: 'expired',
      })
      revoked += 1
    }

    return { revoked }
  },
})
