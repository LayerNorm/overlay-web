import { v } from 'convex/values'
import { internal } from '../_generated/api'
import { internalAction, internalMutation, query } from '../_generated/server'
import { validateServerSecret } from '../lib/auth'
import type { Id } from '../_generated/dataModel'

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
 * Cron-triggered action that polls the Workflow SDK event log for active
 * runs and projects new events into the workflowStepEvents table.
 *
 * This replaces per-client SSE polling (every 2 seconds per client) with
 * a single server-side poller (every 10 seconds). Clients subscribe to
 * the projected events via Convex subscription for instant updates.
 */
export const runProjectionTick = internalAction({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const serverSecret = process.env.INTERNAL_API_SECRET
    if (!serverSecret) return null

    const activeRuns = await ctx.runQuery(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (internal as any).automations.workflowEventProjector.listActiveWorkflowRuns,
      { serverSecret, limit: 20 },
    )

    if (activeRuns.length === 0) return null

    // Import Workflow SDK lazily (only when there are active runs)
    const { getRun } = await import('workflow/api')
    const { getWorld } = await import('workflow/runtime')

    let world: ReturnType<typeof getWorld> | null = null
    try {
      world = getWorld()
    } catch {
      // Workflow SDK not available in this environment
      return null
    }

    for (const run of activeRuns) {
      try {
        const workflowRun = getRun(run.workflowRunId)
        const exists = await workflowRun.exists
        if (!exists) continue

        // Get the latest projected event timestamp for this run
        const latestCursor = await ctx.runQuery(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (internal as any).automations.workflowEventProjector.getLatestEventCursor,
          { workflowRunId: run.workflowRunId, serverSecret },
        )

        // Fetch events from the Workflow SDK
        const eventPage = await world.events.list({
          runId: run.workflowRunId,
          resolveData: 'none',
        })

        // Project new events into Convex
        for (const event of eventPage.data) {
          const eventTime = event.createdAt.getTime()
          if (latestCursor && eventTime <= latestCursor) continue

          const eventData = ('eventData' in event ? event.eventData : undefined) as
            | Record<string, unknown>
            | undefined

          // Only project step-level events
          const stepName = eventData?.stepName as string | undefined
          if (!stepName) continue

          const eventType = event.eventType
          const stepStatus: 'running' | 'completed' | 'failed' =
            eventType === 'step_created' ? 'running' :
            eventType === 'step_completed' ? 'completed' :
            eventType === 'step_failed' ? 'failed' :
            eventType === 'step_retrying' ? 'running' :
            'running'

          const error = eventData?.error as string | undefined
          const stack = eventData?.stack as string | undefined
          const attempt = eventData?.attempt as number | undefined

          await ctx.runMutation(
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (internal as any).automations.workflowEventProjector.recordStepEventInternal,
            {
              userId: run.userId,
              workflowRunId: run.workflowRunId,
              stepName,
              stepStatus,
              ...(run._id ? { automationRunId: run._id as Id<'automationRuns'> } : {}),
              ...(attempt !== undefined ? { attempt } : {}),
              ...(error ? { error: error.slice(0, 500) } : {}),
              ...(stack ? { stack: stack.slice(0, 1000) } : {}),
              serverSecret,
            },
          )
        }

        // Check if the run has reached a terminal state
        const runStatus = await workflowRun.status
        if (runStatus === 'completed' || runStatus === 'failed' || runStatus === 'cancelled') {
          // The automationRuns status update is handled by the workflow itself
          // or the finalizeRun step. We don't need to update it here.
        }
      } catch (_error) {
        // Skip this run on error, continue with the next one
      }
    }

    return null
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
