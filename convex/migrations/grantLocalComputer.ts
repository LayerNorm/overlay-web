import { v } from 'convex/values'
import { internal } from '../_generated/api'
import { internalMutation } from '../_generated/server'
import { agentToolCapabilityGrantId } from '../../src/shared/agents/tool-groups'

/**
 * The Local computer tool group (internal/develop/thread-folders.md) arrived after agents had saved grants, so those
 * grants don't name it and their threads could not run on the person's own computer. This adds it to every agent that
 * can already change files; read-only agents and the default agent (which holds every group without listing them)
 * are left alone. Idempotent and self-continuing:
 *
 *   npx convex run migrations/grantLocalComputer:run '{"dryRun":true}'
 *   npx convex run migrations/grantLocalComputer:run
 */
const LOCAL_COMPUTER = agentToolCapabilityGrantId('local_computer')

export function needsLocalComputer(allowedToolIds: readonly string[] | undefined): boolean {
  return Boolean(allowedToolIds?.includes('write_file')) && !allowedToolIds!.includes(LOCAL_COMPUTER)
}

export const run = internalMutation({
  args: { cursor: v.optional(v.union(v.string(), v.null())), dryRun: v.optional(v.boolean()), granted: v.optional(v.number()) },
  handler: async (ctx, args): Promise<{ granted: number; isDone: boolean }> => {
    const page = await ctx.db.query('workspaceAgentDefinitions').paginate({ cursor: args.cursor ?? null, numItems: 200 })
    let granted = args.granted ?? 0
    for (const row of page.page) {
      if (!needsLocalComputer(row.allowedToolIds)) continue
      granted += 1
      if (!args.dryRun) await ctx.db.patch(row._id, { allowedToolIds: [...row.allowedToolIds, LOCAL_COMPUTER] })
    }
    if (!page.isDone) {
      await ctx.scheduler.runAfter(0, internal.migrations.grantLocalComputer.run, { cursor: page.continueCursor, dryRun: args.dryRun, granted })
    }
    return { granted, isDone: page.isDone }
  },
})
