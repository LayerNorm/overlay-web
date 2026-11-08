import { v } from 'convex/values'
import { internal } from '../_generated/api'
import { internalMutation } from '../_generated/server'
import { auditWorkspaceId } from '../lib/auditWorkspace'

const BATCH_SIZE = 200

/**
 * Copies `metadata.workspaceId` onto audit rows written before the
 * `by_workspaceId_createdAt` index existed, so workspace metrics and audit
 * exports include older events. Idempotent and self-continuing; start it with
 * `npx convex run migrations/backfillAuditWorkspaceIds:run`. Pass
 * `'{"dryRun":true}'` to preview the first batch without writing.
 */
export const run = internalMutation({
  args: { cursor: v.optional(v.union(v.string(), v.null())), dryRun: v.optional(v.boolean()) },
  returns: v.object({ scanned: v.number(), updated: v.number(), isDone: v.boolean() }),
  handler: async (ctx, args) => {
    const page = await ctx.db
      .query('auditEvents')
      .paginate({ cursor: args.cursor ?? null, numItems: BATCH_SIZE })
    let updated = 0
    for (const row of page.page) {
      if (row.workspaceId) continue
      const workspaceId = auditWorkspaceId(row.metadataJson)
      if (!workspaceId) continue
      updated += 1
      if (!args.dryRun) await ctx.db.patch(row._id, { workspaceId })
    }
    if (!page.isDone && !args.dryRun) {
      await ctx.scheduler.runAfter(0, internal.migrations.backfillAuditWorkspaceIds.run, {
        cursor: page.continueCursor,
      })
    }
    return { scanned: page.page.length, updated, isDone: page.isDone }
  },
})
