import { internalMutation } from '../_generated/server'

/** Maximum age for function metrics rows (7 days). */
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1_000

/**
 * Deletes function metrics older than 7 days, every 6 hours. Nothing writes
 * this table any more; the cron stays only until old rows are gone, then the
 * table, this file and the cron can be removed together.
 */
export const cleanupOldMetricsInternal = internalMutation({
  args: {},
  handler: async (ctx) => {
    const cutoff = Date.now() - MAX_AGE_MS
    const oldMetrics = await ctx.db
      .query('functionMetrics')
      .withIndex('by_timestamp', (q) => q.lt('timestamp', cutoff))
      .take(500)

    await Promise.all(oldMetrics.map((metric) => ctx.db.delete(metric._id)))
  },
})
