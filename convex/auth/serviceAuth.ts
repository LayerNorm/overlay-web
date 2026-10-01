import { v } from 'convex/values'
import { internalMutation, mutation } from '../_generated/server'
import { requireServerSecret } from '../lib/auth'

export const consumeReplayNonceByServer = mutation({
  args: {
    serverSecret: v.string(),
    jti: v.string(),
    subject: v.string(),
    method: v.string(),
    path: v.string(),
    expiresAt: v.number(),
  },
  returns: v.object({
    consumed: v.boolean(),
    reason: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)

    const now = Date.now()
    const jti = args.jti.trim()
    const subject = args.subject.trim()
    const method = args.method.trim().toUpperCase()
    const path = args.path.trim() || '/'

    if (!jti || !subject || !method || !path) {
      return { consumed: false, reason: 'invalid_nonce' }
    }
    if (!Number.isFinite(args.expiresAt) || args.expiresAt <= now) {
      return { consumed: false, reason: 'expired' }
    }

    const existing = await ctx.db
      .query('serviceAuthReplayNonces')
      .withIndex('by_jti', (q) => q.eq('jti', jti))
      .unique()
    if (existing) {
      return { consumed: false, reason: 'replay' }
    }

    await ctx.db.insert('serviceAuthReplayNonces', {
      jti,
      subject,
      method,
      path,
      expiresAt: args.expiresAt,
      consumedAt: now,
    })

    return { consumed: true }
  },
})

export const cleanupExpiredReplayNoncesByServer = mutation({
  args: {
    serverSecret: v.string(),
    now: v.optional(v.number()),
    limit: v.optional(v.number()),
  },
  returns: v.object({ deleted: v.number() }),
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const now = args.now ?? Date.now()
    const limit = Math.min(Math.max(args.limit ?? 500, 1), 2000)
    const expired = await ctx.db
      .query('serviceAuthReplayNonces')
      .withIndex('by_expiresAt', (q) => q.lt('expiresAt', now))
      .take(limit)

    await Promise.all(expired.map((row) => ctx.db.delete(row._id)))

    return { deleted: expired.length }
  },
})

export const cleanupExpiredReplayNoncesInternal = internalMutation({
  args: {
    now: v.optional(v.number()),
    limit: v.optional(v.number()),
  },
  returns: v.object({ deleted: v.number() }),
  handler: async (ctx, args) => {
    const now = args.now ?? Date.now()
    const limit = Math.min(Math.max(args.limit ?? 500, 1), 2000)
    const expired = await ctx.db
      .query('serviceAuthReplayNonces')
      .withIndex('by_expiresAt', (q) => q.lt('expiresAt', now))
      .take(limit)

    await Promise.all(expired.map((row) => ctx.db.delete(row._id)))

    return { deleted: expired.length }
  },
})
