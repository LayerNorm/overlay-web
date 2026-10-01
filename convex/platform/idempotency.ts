import { v } from 'convex/values'
import { internalMutation, mutation } from '../_generated/server'
import type { MutationCtx } from '../_generated/server'
import { requireServerSecret } from '../lib/auth'

const PRUNE_BATCH_SIZE = 100
const STREAM_IDEMPOTENCY_RESPONSE_MARKER = '__overlay_stream_started__'

const responseHeadersValidator = v.array(v.object({
  name: v.string(),
  value: v.string(),
}))

export const reserveByServer = mutation({
  args: {
    serverSecret: v.string(),
    userId: v.string(),
    keyHash: v.string(),
    requestHash: v.string(),
    method: v.string(),
    path: v.string(),
    expiresAt: v.number(),
  },
  returns: v.object({
    status: v.union(
      v.literal('reserved'),
      v.literal('replay'),
      v.literal('in_flight'),
      v.literal('conflict'),
    ),
    responseStatus: v.optional(v.number()),
    responseHeaders: v.optional(responseHeadersValidator),
    responseBody: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)

    const now = Date.now()
    const expired = await ctx.db
      .query('apiIdempotencyKeys')
      .withIndex('by_expiresAt', (q) => q.lt('expiresAt', now))
      .take(PRUNE_BATCH_SIZE)

    await Promise.all(expired.map((row) => ctx.db.delete(row._id)))

    const existing = await ctx.db
      .query('apiIdempotencyKeys')
      .withIndex('by_keyHash', (q) => q.eq('keyHash', args.keyHash))
      .unique()

    if (existing) {
      if (existing.requestHash !== args.requestHash) {
        return { status: 'conflict' as const }
      }
      if (existing.status === 'completed') {
        return {
          status: 'replay' as const,
          responseStatus: existing.responseStatus,
          responseHeaders: existing.responseHeaders,
          responseBody: existing.responseBody,
        }
      }
      return { status: 'in_flight' as const }
    }

    await ctx.db.insert('apiIdempotencyKeys', {
      userId: args.userId,
      keyHash: args.keyHash,
      requestHash: args.requestHash,
      method: args.method.toUpperCase(),
      path: args.path,
      status: 'processing',
      createdAt: now,
      updatedAt: now,
      expiresAt: args.expiresAt,
    })

    return { status: 'reserved' as const }
  },
})

export const completeStreamStartedByServer = mutation({
  args: {
    serverSecret: v.string(),
    keyHash: v.string(),
    requestHash: v.string(),
  },
  returns: v.object({ completed: v.boolean() }),
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)

    const existing = await ctx.db
      .query('apiIdempotencyKeys')
      .withIndex('by_keyHash', (q) => q.eq('keyHash', args.keyHash))
      .unique()
    if (!existing || existing.requestHash !== args.requestHash) {
      return { completed: false }
    }

    await ctx.db.patch(existing._id, {
      status: 'completed',
      responseStatus: 200,
      responseHeaders: [{ name: 'x-overlay-idempotency-kind', value: 'stream' }],
      responseBody: STREAM_IDEMPOTENCY_RESPONSE_MARKER,
      updatedAt: Date.now(),
    })

    return { completed: true }
  },
})

export const completeByServer = mutation({
  args: {
    serverSecret: v.string(),
    keyHash: v.string(),
    requestHash: v.string(),
    responseStatus: v.number(),
    responseHeaders: responseHeadersValidator,
    responseBody: v.string(),
  },
  returns: v.object({ completed: v.boolean() }),
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)

    const existing = await ctx.db
      .query('apiIdempotencyKeys')
      .withIndex('by_keyHash', (q) => q.eq('keyHash', args.keyHash))
      .unique()
    if (!existing || existing.requestHash !== args.requestHash) {
      return { completed: false }
    }

    await ctx.db.patch(existing._id, {
      status: 'completed',
      responseStatus: args.responseStatus,
      responseHeaders: args.responseHeaders,
      responseBody: args.responseBody,
      updatedAt: Date.now(),
    })

    return { completed: true }
  },
})

export const discardByServer = mutation({
  args: {
    serverSecret: v.string(),
    keyHash: v.string(),
    requestHash: v.string(),
  },
  returns: v.object({ discarded: v.boolean() }),
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)

    const existing = await ctx.db
      .query('apiIdempotencyKeys')
      .withIndex('by_keyHash', (q) => q.eq('keyHash', args.keyHash))
      .unique()
    if (!existing || existing.requestHash !== args.requestHash) {
      return { discarded: false }
    }

    await ctx.db.delete(existing._id)
    return { discarded: true }
  },
})

export const cleanupExpiredByServer = mutation({
  args: {
    serverSecret: v.string(),
    now: v.optional(v.number()),
    limit: v.optional(v.number()),
  },
  returns: v.object({ deleted: v.number() }),
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    return cleanupExpired(ctx, args.now, args.limit)
  },
})

export const cleanupExpiredInternal = internalMutation({
  args: {
    now: v.optional(v.number()),
    limit: v.optional(v.number()),
  },
  returns: v.object({ deleted: v.number() }),
  handler: async (ctx, args) => {
    return cleanupExpired(ctx, args.now, args.limit)
  },
})

async function cleanupExpired(
  ctx: MutationCtx,
  now = Date.now(),
  limit = 500,
): Promise<{ deleted: number }> {
  const cappedLimit = Math.min(Math.max(limit, 1), 2000)
  const expired = await ctx.db
    .query('apiIdempotencyKeys')
    .withIndex('by_expiresAt', (q) => q.lt('expiresAt', now))
    .take(cappedLimit)

  await Promise.all(expired.map((row) => ctx.db.delete(row._id)))

  return { deleted: expired.length }
}
