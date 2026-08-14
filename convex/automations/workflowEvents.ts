import { v } from 'convex/values'
import { mutation, query } from '../_generated/server'
import { requireAccessToken, validateServerSecret } from '../lib/auth'

/**
 * Record a workflow step event (server-secret only, called by the
 * workflow execution hook that projects Workflow SDK events into Convex).
 */
export const recordStepEvent = mutation({
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
  returns: v.string(),
  handler: async (ctx, args) => {
    if (!validateServerSecret(args.serverSecret)) {
      throw new Error('Unauthorized')
    }
    const now = Date.now()
    const eventId = await ctx.db.insert('workflowStepEvents', {
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
    return eventId as string
  },
})

/**
 * Live subscription for workflow step events by workflow run ID.
 * The client uses this instead of polling the SSE endpoint every 2 seconds.
 * Returns all events for the given workflowRunId, ordered by creation time.
 */
export const watchWorkflowStepEvents = query({
  args: {
    userId: v.string(),
    workflowRunId: v.string(),
    accessToken: v.string(),
  },
  returns: v.array(v.object({
    _id: v.string(),
    stepName: v.string(),
    stepStatus: v.string(),
    attempt: v.optional(v.number()),
    error: v.optional(v.string()),
    stack: v.optional(v.string()),
    createdAt: v.number(),
  })),
  handler: async (ctx, args) => {
    try {
      await requireAccessToken(args.accessToken, args.userId)
    } catch {
      return []
    }
    const events = await ctx.db
      .query('workflowStepEvents')
      .withIndex('by_workflowRunId_createdAt', (q) =>
        q.eq('workflowRunId', args.workflowRunId),
      )
      .order('asc')
      .collect()
    return events.map((e) => ({
      _id: e._id as string,
      stepName: e.stepName,
      stepStatus: e.stepStatus,
      ...(e.attempt !== undefined ? { attempt: e.attempt } : {}),
      ...(e.error ? { error: e.error } : {}),
      ...(e.stack ? { stack: e.stack } : {}),
      createdAt: e.createdAt,
    }))
  },
})

/**
 * Live subscription for workflow step events by automation run ID.
 * Alternative to watchWorkflowStepEvents when the client has the
 * automationRunId but not the workflowRunId.
 */
export const watchAutomationRunStepEvents = query({
  args: {
    userId: v.string(),
    automationRunId: v.id('automationRuns'),
    accessToken: v.string(),
  },
  returns: v.array(v.object({
    _id: v.string(),
    stepName: v.string(),
    stepStatus: v.string(),
    attempt: v.optional(v.number()),
    error: v.optional(v.string()),
    stack: v.optional(v.string()),
    createdAt: v.number(),
  })),
  handler: async (ctx, args) => {
    try {
      await requireAccessToken(args.accessToken, args.userId)
    } catch {
      return []
    }
    const events = await ctx.db
      .query('workflowStepEvents')
      .withIndex('by_automationRunId_createdAt', (q) =>
        q.eq('automationRunId', args.automationRunId),
      )
      .order('asc')
      .collect()
    return events.map((e) => ({
      _id: e._id as string,
      stepName: e.stepName,
      stepStatus: e.stepStatus,
      ...(e.attempt !== undefined ? { attempt: e.attempt } : {}),
      ...(e.error ? { error: e.error } : {}),
      ...(e.stack ? { stack: e.stack } : {}),
      createdAt: e.createdAt,
    }))
  },
})
