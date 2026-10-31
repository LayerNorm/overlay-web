import { paginationOptsValidator } from 'convex/server'
import { v } from 'convex/values'
import { internalMutation } from '../_generated/server'

/** Owner-requested one-time rollout. Never schedule or rerun after acceptance. */
export const enableExistingAccounts = internalMutation({
  args: { paginationOpts: paginationOptsValidator, dryRun: v.boolean() },
  returns: v.object({
    scanned: v.number(),
    changed: v.number(),
    isDone: v.boolean(),
    continueCursor: v.string(),
  }),
  handler: async (ctx, { paginationOpts, dryRun }) => {
    const page = await ctx.db.query('userUiSettings').paginate({
      ...paginationOpts,
      numItems: Math.min(Math.max(paginationOpts.numItems, 1), 100),
    })
    let changed = 0
    for (const row of page.page) {
      if (row.useSecondarySidebar === true) continue
      changed += 1
      if (!dryRun) await ctx.db.patch(row._id, { useSecondarySidebar: true })
    }
    return { scanned: page.page.length, changed, isDone: page.isDone, continueCursor: page.continueCursor }
  },
})
