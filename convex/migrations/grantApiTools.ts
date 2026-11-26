import { v } from 'convex/values'
import { internal } from '../_generated/api'
import { internalMutation } from '../_generated/server'
import { AGENT_TOOL_GROUPS } from '../../src/shared/agents/tool-groups'

/**
 * The Data and APIs tool group (internal/develop/monid.md) arrived after agents had saved grants, so those grants don't
 * name it. This adds its tools to every agent with a saved tool list. Agents with an empty list are left alone: the
 * default agent then holds every group without listing them, and any other agent was deliberately given no tools.
 * Turning the group off later sticks, because this runs once rather than on every read. Idempotent and self-continuing:
 *
 *   npx convex run migrations/grantApiTools:run '{"dryRun":true}'
 *   npx convex run migrations/grantApiTools:run
 */
const API_TOOL_IDS = AGENT_TOOL_GROUPS.find((group) => group.id === 'apis')!.toolIds

export function missingApiTools(allowedToolIds: readonly string[] | undefined): string[] {
  if (!allowedToolIds?.length) return []
  return API_TOOL_IDS.filter((id) => !allowedToolIds.includes(id))
}

export const run = internalMutation({
  args: { cursor: v.optional(v.union(v.string(), v.null())), dryRun: v.optional(v.boolean()), granted: v.optional(v.number()) },
  handler: async (ctx, args): Promise<{ granted: number; isDone: boolean }> => {
    const page = await ctx.db.query('workspaceAgentDefinitions').paginate({ cursor: args.cursor ?? null, numItems: 200 })
    let granted = args.granted ?? 0
    for (const row of page.page) {
      const missing = missingApiTools(row.allowedToolIds)
      if (missing.length === 0) continue
      granted += 1
      if (!args.dryRun) await ctx.db.patch(row._id, { allowedToolIds: [...row.allowedToolIds, ...missing] })
    }
    if (!page.isDone) {
      await ctx.scheduler.runAfter(0, internal.migrations.grantApiTools.run, { cursor: page.continueCursor, dryRun: args.dryRun, granted })
    }
    return { granted, isDone: page.isDone }
  },
})
