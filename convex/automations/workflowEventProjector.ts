import { v } from 'convex/values'
import { internalMutation, query } from '../_generated/server'
import { validateServerSecret } from '../lib/auth'

/**
 * List active automation runs that have a workflowRunId but are not yet
 * in a terminal state (server-secret only).
 */
export const listActiveWorkflowRuns = query({
  args: {
    serverSecret: v.string(),
    limit: v.optional(v.number()),
  },
  returns: v.array(v.object({
    _id: v.string(),
    userId: v.string(),
    workflowRunId: v.string(),
    status: v.string(),
  })),
  handler: async (ctx, args) => {
    if (!validateServerSecret(args.serverSecret)) return []
    const limit = Math.min(50, Math.max(1, args.limit ?? 20))
    const running = await ctx.db
      .query('automationRuns')
      .withIndex('by_status_scheduledFor', (q) => q.eq('status', 'running'))
      .take(limit)
    return running
      .filter((run) => run.workflowRunId)
      .map((run) => ({
        _id: run._id as string,
        userId: run.userId,
        workflowRunId: run.workflowRunId!,
        status: run.status,
      }))
  },
})

/**
 * Get the latest event cursor for a workflow run (to avoid re-projecting
 * events that have already been recorded).
 */
export const getLatestEventCursor = query({
  args: {
    workflowRunId: v.string(),
    serverSecret: v.string(),
  },
  returns: v.union(v.number(), v.null()),
  handler: async (ctx, args) => {
    if (!validateServerSecret(args.serverSecret)) return null
    const latest = await ctx.db
      .query('workflowStepEvents')
      .withIndex('by_workflowRunId_createdAt', (q) =>
        q.eq('workflowRunId', args.workflowRunId),
      )
      .order('desc')
      .first()
    return latest?.createdAt ?? null
  },
})

/**
 * Internal mutation to record a step event (called by the projection action).
 */
export const recordStepEventInternal = internalMutation({
  args: {
    userId: v.string(),
    workflowRunId: v.string(),
    stepName: v.string(),
    stepStatus: v.union(
      v.literal('running'),
      v.literal('completed'),
      v.literal('failed'),
    ),
    automationRunId: v.optional(v.id('automationRuns')),
    attempt: v.optional(v.number()),
    error: v.optional(v.string()),
    stack: v.optional(v.string()),
    serverSecret: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    if (!validateServerSecret(args.serverSecret)) return null
    const now = Date.now()
    await ctx.db.insert('workflowStepEvents', {
      userId: args.userId,
      workflowRunId: args.workflowRunId,
      stepName: args.stepName,
      stepStatus: args.stepStatus,
      ...(args.automationRunId ? { automationRunId: args.automationRunId } : {}),
      ...(args.attempt !== undefined ? { attempt: args.attempt } : {}),
      ...(args.error ? { error: args.error } : {}),
      ...(args.stack ? { stack: args.stack } : {}),
      createdAt: now,
    })
    return null
  },
})
