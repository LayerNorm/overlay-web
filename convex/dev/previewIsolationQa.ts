import { v } from 'convex/values'
import { internalQuery } from '../_generated/server'
import { requirePreviewDeployment } from '../lib/preview'

/** Temporary release QA fixture: this branch requires a number value. */
export const read = internalQuery({
  args: {},
  returns: v.number(),
  handler: async ctx => {
    requirePreviewDeployment()
    const row = await ctx.db.query('releasePreviewIsolationQa')
      .withIndex('by_marker', q => q.eq('marker', 'isolation-fixture')).unique()
    if (!row) throw new Error('Isolation fixture is missing')
    return row.value
  },
})
