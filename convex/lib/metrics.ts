/**
 * Lightweight Convex function metrics wrapper.
 *
 * Wraps query/mutation handlers to capture function name, duration, and
 * document read/write counts.  Metrics are stored in the `functionMetrics`
 * table for periodic export to PostHog via the BFF.
 *
 * Usage:
 * ```ts
 * import { withMetrics } from '../lib/metrics'
 *
 * export const list = query({
 *   args: { ... },
 *   handler: withMetrics('chat.conversations.list', async (ctx, args) => {
 *     // existing handler body
 *   }),
 * })
 * ```
 */

import { internalMutation } from '../_generated/server'
import { v } from 'convex/values'

/**
 * Internal mutation to record a function metric.  Called fire-and-forget
 * from within query/mutation handlers.
 */
export const recordFunctionMetric = internalMutation({
  args: {
    functionName: v.string(),
    durationMs: v.number(),
    docsRead: v.optional(v.number()),
    docsWritten: v.optional(v.number()),
    responseBytes: v.optional(v.number()),
    timestamp: v.number(),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert('functionMetrics', {
      functionName: args.functionName,
      durationMs: args.durationMs,
      docsRead: args.docsRead,
      docsWritten: args.docsWritten,
      responseBytes: args.responseBytes,
      timestamp: args.timestamp,
    })
  },
})

/**
 * Wraps a Convex mutation handler with timing instrumentation.
 * The wrapper records function name, duration, and error status to the
 * `functionMetrics` table for periodic export.
 *
 * Only use this on mutations — queries cannot write to the metrics table.
 * For queries, timing is captured at the BFF boundary instead.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
export function withMetrics<Ret>(
  functionName: string,
  handler: (ctx: any, args: any) => Promise<Ret>,
): (ctx: any, args: any) => Promise<Ret> {
  return async (ctx, args): Promise<Ret> => {
    const startTime = Date.now()
    try {
      const result = await handler(ctx, args)
      const durationMs = Date.now() - startTime

      // Fire-and-forget metric recording.
      try {
        await ctx.db.insert('functionMetrics', {
          functionName,
          durationMs,
          timestamp: startTime,
        })
      } catch {
        // metrics must never break the function
      }

      return result
    } catch (error) {
      const durationMs = Date.now() - startTime
      try {
        await ctx.db.insert('functionMetrics', {
          functionName,
          durationMs,
          timestamp: startTime,
          error: true,
        })
      } catch {
        // ignore
      }
      throw error
    }
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */
