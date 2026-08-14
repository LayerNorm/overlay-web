import { v } from 'convex/values'
import { query, mutation } from '../_generated/server'
import { requireServerSecret } from '../lib/auth'

/**
 * Checks whether a one-time migration has been completed for a given scope.
 * Used by BFF routes to skip migration-on-read patterns after the first run.
 */
export const isComplete = query({
  args: {
    serverSecret: v.string(),
    key: v.string(),
    scope: v.string(),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const marker = await ctx.db
      .query('migrationMarkers')
      .withIndex('by_key_scope', (q) => q.eq('key', args.key).eq('scope', args.scope))
      .unique()
    return Boolean(marker)
  },
})

/**
 * Marks a one-time migration as complete for a given scope.
 * Safe to call multiple times — it's idempotent.
 */
export const markComplete = mutation({
  args: {
    serverSecret: v.string(),
    key: v.string(),
    scope: v.string(),
    now: v.number(),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const existing = await ctx.db
      .query('migrationMarkers')
      .withIndex('by_key_scope', (q) => q.eq('key', args.key).eq('scope', args.scope))
      .unique()
    if (existing) return false
    await ctx.db.insert('migrationMarkers', {
      key: args.key,
      scope: args.scope,
      completedAt: args.now,
    })
    return true
  },
})
