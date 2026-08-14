import { v } from 'convex/values'
import { internalMutation, mutation } from '../_generated/server'
import { requireServerSecret } from '../lib/auth'

const PRUNE_BATCH_SIZE = 100

export const takeManyByServer = mutation({
  args: {
    serverSecret: v.string(),
    rules: v.array(v.object({
      bucket: v.string(),
      bucketKey: v.string(),
      limit: v.number(),
      windowMs: v.number(),
    })),
  },
  returns: v.array(v.object({
    bucket: v.string(),
    allowed: v.boolean(),
    remaining: v.number(),
    retryAfterSeconds: v.number(),
  })),
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)

    // Pruning of expired rate-limit windows has been moved to a periodic
    // cron job (pruneExpiredWindowsInternal).  The request path no longer
    // does any pruning — it only reads and updates the bucket for the
    // current rule.  This eliminates N extra deletes per request.

    const now = Date.now()
    const results: Array<{
      bucket: string
      allowed: boolean
      remaining: number
      retryAfterSeconds: number
    }> = []

    for (const rule of args.rules) {
      const bucketKey = rule.bucketKey.trim()
      if (!bucketKey) {
        results.push({
          bucket: rule.bucket,
          allowed: true,
          remaining: rule.limit,
          retryAfterSeconds: 0,
        })
        continue
      }

      const existing = await ctx.db
        .query('rateLimitWindows')
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .withIndex('by_bucketKey', (q: any) => q.eq('bucketKey', bucketKey))
        .first()

      if (!existing || existing.resetAt <= now) {
        const resetAt = now + rule.windowMs
        if (existing) {
          await ctx.db.patch(existing._id, {
            bucket: rule.bucket,
            count: 1,
            resetAt,
            updatedAt: now,
          })
        } else {
          await ctx.db.insert('rateLimitWindows', {
            bucket: rule.bucket,
            bucketKey,
            count: 1,
            resetAt,
            updatedAt: now,
          })
        }

        results.push({
          bucket: rule.bucket,
          allowed: true,
          remaining: Math.max(0, rule.limit - 1),
          retryAfterSeconds: Math.ceil(rule.windowMs / 1000),
        })
        continue
      }

      if (existing.count >= rule.limit) {
        results.push({
          bucket: rule.bucket,
          allowed: false,
          remaining: 0,
          retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)),
        })
        continue
      }

      const nextCount = existing.count + 1
      await ctx.db.patch(existing._id, {
        count: nextCount,
        updatedAt: now,
      })

      results.push({
        bucket: rule.bucket,
        allowed: true,
        remaining: Math.max(0, rule.limit - nextCount),
        retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)),
      })
    }

    return results
  },
})

/**
 * Periodic cleanup of expired rate-limit windows.
 * Runs via cron every 5 minutes — not in the request path.
 */
export const pruneExpiredWindowsInternal = internalMutation({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    const now = Date.now()
    const expired = await ctx.db
      .query('rateLimitWindows')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .withIndex('by_resetAt', (q: any) => q.lt('resetAt', now))
      .take(PRUNE_BATCH_SIZE)

    for (const row of expired) {
      await ctx.db.delete(row._id)
    }

    return expired.length
  },
})
