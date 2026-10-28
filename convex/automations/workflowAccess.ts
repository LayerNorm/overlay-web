import { v } from 'convex/values'
import { query, type QueryCtx } from '../_generated/server'
import { requireServerSecret } from '../lib/auth'
import { getReadableRow } from '../lib/resourceScope'

export async function readableWorkflowAutomation(
  ctx: QueryCtx,
  args: { workflowRunId: string; userId: string; workspaceId?: string },
) {
  const run = await ctx.db.query('automationRuns')
    .withIndex('by_workflowRunId', q => q.eq('workflowRunId', args.workflowRunId)).unique()
  const automation = run
    ? await ctx.db.get(run.automationId)
    : await ctx.db.query('automations')
      .withIndex('by_schedulerWorkflowRunId', q => q.eq('schedulerWorkflowRunId', args.workflowRunId)).unique()
  if (!automation || automation.deletedAt) return null
  return await getReadableRow(ctx, { row: automation, userId: args.userId, workspaceId: args.workspaceId })
}

export const canReadByServer = query({
  args: { serverSecret: v.string(), workflowRunId: v.string(), userId: v.string(), workspaceId: v.string() },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    return Boolean(await readableWorkflowAutomation(ctx, args))
  },
})
