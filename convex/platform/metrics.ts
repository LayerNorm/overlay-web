import { internalMutation, internalQuery } from '../_generated/server'
import { v } from 'convex/values'

/** Maximum age for function metrics rows (7 days). */
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1_000

/**
 * Internal cron job to clean up old function metrics.
 * Runs every 6 hours and deletes rows older than 7 days.
 */
export const cleanupOldMetricsInternal = internalMutation({
  args: {},
  handler: async (ctx) => {
    const cutoff = Date.now() - MAX_AGE_MS
    const oldMetrics = await ctx.db
      .query('functionMetrics')
      .withIndex('by_timestamp', (q) => q.lt('timestamp', cutoff))
      .take(500)

    for (const metric of oldMetrics) {
      await ctx.db.delete(metric._id)
    }
  },
})

/**
 * Internal query to aggregate function metrics for export to PostHog.
 * Returns per-function summaries for a time window.
 */
export const aggregateMetricsInternal = internalQuery({
  args: {
    fromTimestamp: v.number(),
    toTimestamp: v.number(),
  },
  handler: async (ctx, args) => {
    const metrics = await ctx.db
      .query('functionMetrics')
      .withIndex('by_timestamp', (q) =>
        q.gte('timestamp', args.fromTimestamp).lt('timestamp', args.toTimestamp),
      )
      .take(1000)

    const byFunction = new Map<string, {
      count: number
      totalDurationMs: number
      errors: number
      docsRead: number
      docsWritten: number
    }>()

    for (const m of metrics) {
      const existing = byFunction.get(m.functionName) ?? {
        count: 0,
        totalDurationMs: 0,
        errors: 0,
        docsRead: 0,
        docsWritten: 0,
      }
      existing.count += 1
      existing.totalDurationMs += m.durationMs
      if (m.error) existing.errors += 1
      existing.docsRead += m.docsRead ?? 0
      existing.docsWritten += m.docsWritten ?? 0
      byFunction.set(m.functionName, existing)
    }

    return Array.from(byFunction.entries()).map(([name, stats]) => ({
      functionName: name,
      ...stats,
      avgDurationMs: stats.count > 0 ? Math.round(stats.totalDurationMs / stats.count) : 0,
    }))
  },
})
