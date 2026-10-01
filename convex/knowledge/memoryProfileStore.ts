/**
 * Storage side of the M2 compiled profile — queries/mutations live here
 * (default Convex runtime); the billed compile action lives in
 * `memoryProfiles.ts` (node runtime).
 */
import { internalMutation, internalQuery, query } from '../_generated/server'
import { v } from 'convex/values'
import type { Doc, Id } from '../_generated/dataModel'
import type { QueryCtx } from '../_generated/server'
import { requireAccessToken, validateServerSecret } from '../lib/auth'

export const PROFILE_MEMORY_LIMIT = 200
export const PROFILE_RECOMPILE_THROTTLE_MS = 10 * 60 * 1000

async function findProfile(
  ctx: QueryCtx,
  ownerId: string,
  workspaceId?: string,
): Promise<Doc<'memoryProfiles'> | null> {
  const rows = await ctx.db
    .query('memoryProfiles')
    .withIndex('by_ownerId', (q) => q.eq('ownerId', ownerId))
    .collect()
  // Prefer the workspace-scoped profile when asked for one; fall back to the
  // personal profile (or any) so callers still get a compiled block.
  const row = workspaceId === undefined
    ? (rows.find((r) => r.workspaceId === undefined) ?? rows[0])
    : (rows.find((r) => r.workspaceId === workspaceId) ?? rows.find((r) => r.workspaceId === undefined))
  return row ?? null
}

function toPublic(row: Doc<'memoryProfiles'>) {
  return {
    content: row.content,
    sourceMemoryCount: row.sourceMemoryCount,
    generatedAt: row.generatedAt,
    modelId: row.modelId,
  }
}

/** Latest memories eligible for the profile — non-deleted, non-superseded. */
export const listForProfile = internalQuery({
  args: {
    ownerId: v.string(),
    workspaceId: v.optional(v.string()),
    limit: v.number(),
  },
  handler: async (ctx, { ownerId, workspaceId, limit }) => {
    const rows = await ctx.db
      .query('memories')
      .withIndex('by_userId_updatedAt', (q) => q.eq('userId', ownerId))
      .order('desc')
      .take(limit)
    const now = Date.now()
    return rows
      .filter((m) =>
        !m.deletedAt
        && !m.supersededBy
        && (m.expiresAt === undefined || m.expiresAt > now)
        && (workspaceId === undefined || m.workspaceId === workspaceId || m.workspaceId === undefined)
      )
      .map((m) => ({
        content: m.content,
        type: m.type,
        eventAt: m.eventAt,
        createdAt: m.createdAt,
        updatedAt: m.updatedAt,
      }))
  },
})

export const getProfileInternal = internalQuery({
  args: {
    ownerId: v.string(),
    workspaceId: v.optional(v.string()),
  },
  handler: async (ctx, { ownerId, workspaceId }) => {
    const row = await findProfile(ctx, ownerId, workspaceId)
    return row ? toPublic(row) : null
  },
})

export const upsertProfile = internalMutation({
  args: {
    ownerId: v.string(),
    workspaceId: v.optional(v.string()),
    content: v.string(),
    sourceMemoryCount: v.number(),
    modelId: v.string(),
  },
  handler: async (ctx, args): Promise<Id<'memoryProfiles'>> => {
    const rows = await ctx.db
      .query('memoryProfiles')
      .withIndex('by_ownerId', (q) => q.eq('ownerId', args.ownerId))
      .collect()
    const existing = rows.find((r) => r.workspaceId === args.workspaceId)
    if (existing) {
      await ctx.db.patch(existing._id, {
        content: args.content,
        sourceMemoryCount: args.sourceMemoryCount,
        modelId: args.modelId,
        generatedAt: Date.now(),
      })
      return existing._id
    }
    return await ctx.db.insert('memoryProfiles', {
      ownerId: args.ownerId,
      workspaceId: args.workspaceId,
      content: args.content,
      sourceMemoryCount: args.sourceMemoryCount,
      modelId: args.modelId,
      generatedAt: Date.now(),
    })
  },
})

/** Freshness check for the throttle — the compile action gates on this. */
export const profileStale = internalQuery({
  args: {
    ownerId: v.string(),
    workspaceId: v.optional(v.string()),
  },
  returns: v.boolean(),
  handler: async (ctx, { ownerId, workspaceId }) => {
    const row = await findProfile(ctx, ownerId, workspaceId)
    return !row || Date.now() - row.generatedAt > PROFILE_RECOMPILE_THROTTLE_MS
  },
})

/** App-facing read: the owner's compiled profile, or null when none exists. */
export const getProfile = query({
  args: {
    ownerId: v.string(),
    workspaceId: v.optional(v.string()),
    accessToken: v.optional(v.string()),
    serverSecret: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    if (!validateServerSecret(args.serverSecret)) {
      await requireAccessToken(args.accessToken ?? '', args.ownerId)
    }
    const row = await findProfile(ctx, args.ownerId, args.workspaceId)
    return row ? toPublic(row) : null
  },
})
