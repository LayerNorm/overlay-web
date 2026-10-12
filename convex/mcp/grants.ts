import { v } from 'convex/values'
import { mutation, query, type MutationCtx, type QueryCtx } from '../_generated/server'
import { requireServerSecret } from '../lib/auth'
import type { Doc } from '../_generated/dataModel'

const accessValidator = v.union(v.literal('read'), v.literal('write'), v.literal('full'))
const kindValidator = v.union(v.literal('oauth'), v.literal('token'))

const grantValidator = v.object({
  id: v.string(),
  userId: v.string(),
  workspaceId: v.string(),
  access: accessValidator,
  kind: kindValidator,
  clientName: v.string(),
  clientId: v.optional(v.string()),
  refreshVersion: v.number(),
  createdAt: v.number(),
  lastUsedAt: v.optional(v.number()),
  expiresAt: v.optional(v.number()),
  revokedAt: v.optional(v.number()),
})

/** `lastUsedAt` is written at most this often; every MCP request would otherwise be a write. */
const TOUCH_INTERVAL_MS = 60_000

function toGrant(row: Doc<'mcpGrants'>) {
  return {
    id: row._id, userId: row.userId, workspaceId: row.workspaceId, access: row.access, kind: row.kind,
    clientName: row.clientName, clientId: row.clientId, refreshVersion: row.refreshVersion,
    createdAt: row.createdAt, lastUsedAt: row.lastUsedAt, expiresAt: row.expiresAt, revokedAt: row.revokedAt,
  }
}

async function readById(ctx: QueryCtx | MutationCtx, grantId: string) {
  const id = ctx.db.normalizeId('mcpGrants', grantId)
  return id ? await ctx.db.get(id) : null
}

export const getByServer = query({
  args: { serverSecret: v.string(), grantId: v.string() },
  returns: v.union(v.null(), grantValidator),
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const row = await readById(ctx, args.grantId)
    return row ? toGrant(row) : null
  },
})

/** The person's active grants, newest first. */
export const listByUserByServer = query({
  args: { serverSecret: v.string(), userId: v.string() },
  returns: v.array(grantValidator),
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const rows = await ctx.db.query('mcpGrants').withIndex('by_userId', (q) => q.eq('userId', args.userId)).take(200)
    return rows.filter((row) => row.revokedAt === undefined).sort((a, b) => b.createdAt - a.createdAt).map(toGrant)
  },
})

export const createByServer = mutation({
  args: {
    serverSecret: v.string(), userId: v.string(), workspaceId: v.string(), access: accessValidator, kind: kindValidator,
    clientName: v.string(), clientId: v.optional(v.string()), codeId: v.optional(v.string()),
    expiresAt: v.optional(v.number()), maxActive: v.number(), now: v.number(),
  },
  returns: v.object({ ok: v.boolean(), reason: v.optional(v.string()), id: v.optional(v.string()) }),
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    if (args.codeId) {
      const used = await ctx.db.query('mcpGrants').withIndex('by_codeId', (q) => q.eq('codeId', args.codeId)).first()
      if (used) {
        // A code redeemed twice means it leaked; end the grant it created.
        if (used.revokedAt === undefined) await ctx.db.patch(used._id, { revokedAt: args.now })
        return { ok: false, reason: 'code_already_used' }
      }
    }
    const existing = await ctx.db.query('mcpGrants').withIndex('by_userId', (q) => q.eq('userId', args.userId)).take(200)
    if (existing.filter((row) => row.revokedAt === undefined).length >= args.maxActive) {
      return { ok: false, reason: 'too_many_grants' }
    }
    const id = await ctx.db.insert('mcpGrants', {
      userId: args.userId, workspaceId: args.workspaceId, access: args.access, kind: args.kind,
      clientName: args.clientName, ...(args.clientId ? { clientId: args.clientId } : {}),
      ...(args.codeId ? { codeId: args.codeId } : {}), refreshVersion: 0, createdAt: args.now,
      ...(args.expiresAt ? { expiresAt: args.expiresAt } : {}),
    })
    return { ok: true, id }
  },
})

export const touchByServer = mutation({
  args: { serverSecret: v.string(), grantId: v.string(), now: v.number() },
  returns: v.null(),
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const row = await readById(ctx, args.grantId)
    if (row && (row.lastUsedAt === undefined || args.now - row.lastUsedAt > TOUCH_INTERVAL_MS)) {
      await ctx.db.patch(row._id, { lastUsedAt: args.now })
    }
    return null
  },
})

/**
 * Uses a refresh token: the presented version must be the current one, and the
 * grant moves to the next. An older version is a replay of a rotated token, so the
 * grant is revoked (the real client and the thief are both signed out).
 */
export const rotateRefreshByServer = mutation({
  args: { serverSecret: v.string(), grantId: v.string(), presentedVersion: v.number(), now: v.number() },
  returns: v.object({ ok: v.boolean(), version: v.optional(v.number()), reason: v.optional(v.string()) }),
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const row = await readById(ctx, args.grantId)
    if (!row || row.revokedAt !== undefined) return { ok: false, reason: 'revoked' }
    if (row.kind !== 'oauth') return { ok: false, reason: 'not_refreshable' }
    if (args.presentedVersion !== row.refreshVersion) {
      await ctx.db.patch(row._id, { revokedAt: args.now })
      return { ok: false, reason: 'reused' }
    }
    const version = row.refreshVersion + 1
    await ctx.db.patch(row._id, { refreshVersion: version, lastUsedAt: args.now })
    return { ok: true, version }
  },
})

/** Owner-only. Returns whether a live grant was revoked. */
export const revokeByServer = mutation({
  args: { serverSecret: v.string(), grantId: v.string(), userId: v.string(), now: v.number() },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const row = await readById(ctx, args.grantId)
    if (!row || row.userId !== args.userId || row.revokedAt !== undefined) return false
    await ctx.db.patch(row._id, { revokedAt: args.now })
    return true
  },
})

/** Account deletion: remove every grant the person holds. */
export const deleteAllByUserByServer = mutation({
  args: { serverSecret: v.string(), userId: v.string() },
  returns: v.number(),
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const rows = await ctx.db.query('mcpGrants').withIndex('by_userId', (q) => q.eq('userId', args.userId)).take(500)
    for (const row of rows) await ctx.db.delete(row._id)
    return rows.length
  },
})
