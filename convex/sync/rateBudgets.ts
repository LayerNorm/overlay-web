import { v } from 'convex/values'
import { mutation } from '../_generated/server'
import { validateServerSecret } from '../lib/auth'

/** Lower ranks are served first: live events, then outbound sends, then repair, then history. */
const PRIORITY_RANK = { live: 0, outbound: 1, repair: 2, history: 3 } as const

const priorityValidator = v.union(v.literal('live'), v.literal('outbound'), v.literal('repair'), v.literal('history'))

/** How long a denied caller's claim on the next tokens outlives the moment they become available. */
const RESERVATION_GRACE_MS = 60_000

const budgetArgs = {
  serverSecret: v.string(),
  key: v.string(),
  capacity: v.number(),
  refillPerMinute: v.number(),
}

/**
 * Takes tokens from a provider:org:method bucket. Denials report how long to
 * wait. A denied caller reserves the next tokens for its priority, so history
 * never takes the token a waiting repair or outbound send needs, and every
 * caller is held back while the platform's Retry-After is in force.
 */
export const take = mutation({
  args: { ...budgetArgs, priority: priorityValidator, cost: v.optional(v.number()) },
  returns: v.object({ granted: v.boolean(), waitMs: v.number() }),
  handler: async (ctx, args) => {
    if (!validateServerSecret(args.serverSecret)) throw new Error('Unauthorized')
    const now = Date.now()
    const cost = Math.max(1, args.cost ?? 1)
    const rank = PRIORITY_RANK[args.priority]
    const row = await ctx.db.query('syncRateBudgets').withIndex('by_key', q => q.eq('key', args.key)).unique()
    const tokens = row
      ? Math.min(args.capacity, row.tokens + Math.max(0, now - row.refilledAt) / 60_000 * args.refillPerMinute)
      : args.capacity
    const blockedUntil = row?.blockedUntil !== undefined && row.blockedUntil > now ? row.blockedUntil : undefined
    const reservation = row?.reservedUntil !== undefined && row.reservedUntil > now && row.reservedPriority !== undefined
      ? { rank: row.reservedPriority, until: row.reservedUntil }
      : undefined
    const outranked = reservation !== undefined && reservation.rank < rank
    const granted = blockedUntil === undefined && !outranked && tokens >= cost
    const refillWaitMs = Math.ceil(Math.max(0, cost - tokens) / args.refillPerMinute * 60_000)
    const waitMs = granted
      ? 0
      : Math.max(blockedUntil !== undefined ? blockedUntil - now : 0, outranked ? reservation.until - now : 0, refillWaitMs)
    const kept = reservation && !(granted && reservation.rank === rank) ? reservation : undefined
    const next = !granted && !outranked && (!kept || rank <= kept.rank)
      ? { rank, until: now + waitMs + RESERVATION_GRACE_MS }
      : kept
    const fields = {
      capacity: args.capacity,
      refillPerMinute: args.refillPerMinute,
      tokens: granted ? tokens - cost : tokens,
      refilledAt: now,
      reservedPriority: next?.rank,
      reservedUntil: next?.until,
    }
    if (row) await ctx.db.patch(row._id, fields)
    else await ctx.db.insert('syncRateBudgets', { key: args.key, ...fields })
    return { granted, waitMs }
  },
})

/** Records the platform's Retry-After for a bucket. Every priority waits until it passes. */
export const block = mutation({
  args: { ...budgetArgs, retryAfterMs: v.number() },
  returns: v.null(),
  handler: async (ctx, args) => {
    if (!validateServerSecret(args.serverSecret)) throw new Error('Unauthorized')
    const now = Date.now()
    const until = now + Math.max(1_000, args.retryAfterMs)
    const row = await ctx.db.query('syncRateBudgets').withIndex('by_key', q => q.eq('key', args.key)).unique()
    if (row) {
      await ctx.db.patch(row._id, { blockedUntil: Math.max(row.blockedUntil ?? 0, until) })
      return null
    }
    await ctx.db.insert('syncRateBudgets', {
      key: args.key, capacity: args.capacity, refillPerMinute: args.refillPerMinute, tokens: 0, refilledAt: now, blockedUntil: until,
    })
    return null
  },
})
