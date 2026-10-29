import { v } from 'convex/values'
import { internalMutation, internalQuery, query } from '../_generated/server'
import { validateServerSecret } from '../lib/auth'

/** Include recent terminal runs: short workflows can finish between cron ticks. */
export const listActiveWorkflowRuns = internalQuery({
  args: { serverSecret: v.string(), limit: v.optional(v.number()) },
  returns: v.array(v.object({
    _id: v.id('automationRuns'), userId: v.string(), workflowRunId: v.string(),
    status: v.string(), cursor: v.optional(v.string()),
  })),
  handler: async (ctx, args) => {
    if (!validateServerSecret(args.serverSecret)) return []
    const limit = Math.min(50, Math.max(1, args.limit ?? 20))
    const statuses = ['running', 'cancel_requested', 'completed', 'succeeded', 'failed', 'cancelled', 'dead_letter'] as const
    const groups = await Promise.all(statuses.map(status => {
      const query = ctx.db.query('automationRuns').withIndex('by_status_projectionComplete_scheduledFor', q => {
        const pending = q.eq('status', status).eq('workflowProjectionComplete', undefined)
        return status === 'running' || status === 'cancel_requested'
          ? pending : pending.gte('scheduledFor', Date.now() - 86_400_000)
      })
      return query.take(50)
    }))
    return groups.flat().filter(run => !!run.workflowRunId)
      .sort((a, b) => (a.workflowProjectionUpdatedAt ?? 0) - (b.workflowProjectionUpdatedAt ?? 0))
      .slice(0, limit).flatMap(run => run.workflowRunId ? [{
        _id: run._id, userId: run.userId, workflowRunId: run.workflowRunId, status: run.status,
        ...(run.workflowProjectionCursor ? { cursor: run.workflowProjectionCursor } : {}),
      }] : [])
  },
})

/** Commit one SDK page and its cursor together; overlapping ticks and retries are safe. */
export const recordProjectionPage = internalMutation({
  args: {
    serverSecret: v.string(), automationRunId: v.id('automationRuns'), workflowRunId: v.string(),
    expectedCursor: v.union(v.string(), v.null()), cursor: v.union(v.string(), v.null()), complete: v.boolean(),
    events: v.array(v.object({
      sourceEventId: v.string(), correlationId: v.string(), stepName: v.optional(v.string()),
      stepStatus: v.union(v.literal('running'), v.literal('completed'), v.literal('failed')),
      createdAt: v.number(), error: v.optional(v.string()), stack: v.optional(v.string()),
    })),
  },
  returns: v.number(),
  handler: async (ctx, args) => {
    if (!validateServerSecret(args.serverSecret)) throw new Error('Unauthorized')
    if (args.events.length > 100) throw new Error('Projection page exceeds limit')
    const run = await ctx.db.get(args.automationRunId)
    if (!run || run.workflowRunId !== args.workflowRunId) throw new Error('Projection run mismatch')
    if (run.workflowProjectionComplete || (run.workflowProjectionCursor ?? null) !== args.expectedCursor) return 0
    let inserted = 0
    for (const event of args.events) {
      const existing = await ctx.db.query('workflowStepEvents')
        .withIndex('by_workflowRunId_sourceEventId', q => q.eq('workflowRunId', args.workflowRunId).eq('sourceEventId', event.sourceEventId)).unique()
      if (existing) continue
      const created = event.stepName ? null : await ctx.db.query('workflowStepEvents')
        .withIndex('by_workflowRunId_correlationId', q => q.eq('workflowRunId', args.workflowRunId).eq('correlationId', event.correlationId)).first()
      await ctx.db.insert('workflowStepEvents', {
        ...event, stepName: event.stepName ?? created?.stepName ?? event.correlationId,
        userId: run.userId, workflowRunId: run.workflowRunId, automationRunId: run._id,
      })
      inserted++
    }
    await ctx.db.patch(run._id, {
      workflowProjectionCursor: args.cursor ?? run.workflowProjectionCursor,
      ...(args.complete ? { workflowProjectionComplete: true } : {}),
      workflowProjectionUpdatedAt: Date.now(),
    })
    return inserted
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
