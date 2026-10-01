import { v } from 'convex/values'
import { internalMutation } from '../_generated/server'

/**
 * One-off cleanup before the Daytona tables leave the schema. Convex refuses a
 * schema that drops a table still holding documents, so the rows are deleted
 * first. Take a local export of both tables before running:
 *
 *   npx convex export --path daytona-backup.zip
 *   npx convex run migrations/removeDaytonaData:run '{}'
 *
 * Repeat until `done` is true. After that the tables can be dropped from
 * `convex/schema.ts`.
 */
const BATCH = 200

export const run = internalMutation({
  args: { batch: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const limit = Math.max(1, Math.min(args.batch ?? BATCH, 500))
    const ledger = await ctx.db.query('daytonaUsageLedger').take(limit)
    for (const row of ledger) await ctx.db.delete(row._id)
    const workspaces = await ctx.db.query('daytonaWorkspaces').take(Math.max(0, limit - ledger.length))
    for (const row of workspaces) await ctx.db.delete(row._id)
    const deleted = ledger.length + workspaces.length
    return { deleted, done: deleted < limit }
  },
})
