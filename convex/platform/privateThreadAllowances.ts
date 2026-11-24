import { v } from 'convex/values'
import { mutation, query } from '../_generated/server'
import { requireServerSecret } from '../lib/auth'

/**
 * Free-tier counters for private threads (internal/develop/private-threads.md). The server decides the limit and the
 * period; this only counts, atomically, so concurrent searches cannot overshoot it.
 */

const resource = v.literal('web_search')

export const consumeByServer = mutation({
  args: {
    serverSecret: v.string(),
    userId: v.string(),
    period: v.string(),
    resource,
    amount: v.number(),
    limit: v.number(),
  },
  returns: v.object({ ok: v.boolean(), used: v.number(), limit: v.number() }),
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const amount = Math.max(1, Math.floor(args.amount))
    const row = await ctx.db
      .query('privateThreadAllowances')
      .withIndex('by_userId_period', (q) => q.eq('userId', args.userId).eq('period', args.period))
      .first()
    const used = row?.webSearches ?? 0
    if (used + amount > args.limit) return { ok: false, used, limit: args.limit }
    const now = Date.now()
    if (row) await ctx.db.patch(row._id, { webSearches: used + amount, updatedAt: now })
    else await ctx.db.insert('privateThreadAllowances', { userId: args.userId, period: args.period, webSearches: amount, updatedAt: now })
    return { ok: true, used: used + amount, limit: args.limit }
  },
})

export const getByServer = query({
  args: { serverSecret: v.string(), userId: v.string(), period: v.string() },
  returns: v.object({ webSearches: v.number() }),
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const row = await ctx.db
      .query('privateThreadAllowances')
      .withIndex('by_userId_period', (q) => q.eq('userId', args.userId).eq('period', args.period))
      .first()
    return { webSearches: row?.webSearches ?? 0 }
  },
})
