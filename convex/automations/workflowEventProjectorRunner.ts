"use node";

import { v } from 'convex/values'
import { internal } from '../_generated/api'
import { internalAction } from '../_generated/server'
import type { Id } from '../_generated/dataModel'

/**
 * Cron-triggered action that polls the Workflow SDK event log for active
 * runs and projects new events into the workflowStepEvents table.
 *
 * This replaces per-client SSE polling (every 2 seconds per client) with
 * a single server-side poller (every 10 seconds). Clients subscribe to
 * the projected events via Convex subscription for instant updates.
 *
 * This file uses "use node" because the Workflow SDK imports Node.js
 * built-ins (node:assert, node:crypto via undici). The queries and
 * mutations it calls live in workflowEventProjector.ts (default runtime).
 */
export const runProjectionTick = internalAction({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const serverSecret = process.env.INTERNAL_API_SECRET
    if (!serverSecret) return null

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const activeRuns = await ctx.runQuery((internal as any).automations.workflowEventProjector.listActiveWorkflowRuns, {
      serverSecret,
      limit: 20,
    })

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
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const latestCursor = await ctx.runQuery((internal as any).automations.workflowEventProjector.getLatestEventCursor, {
          workflowRunId: run.workflowRunId,
          serverSecret,
        })

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

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await ctx.runMutation((internal as any).automations.workflowEventProjector.recordStepEventInternal, {
            userId: run.userId,
            workflowRunId: run.workflowRunId,
            stepName,
            stepStatus,
            ...(run._id ? { automationRunId: run._id as Id<'automationRuns'> } : {}),
            ...(attempt !== undefined ? { attempt } : {}),
            ...(error ? { error: error.slice(0, 500) } : {}),
            ...(stack ? { stack: stack.slice(0, 1000) } : {}),
            serverSecret,
          })
        }
      } catch (_error) {
        // Skip this run on error, continue with the next one
      }
    }

    return null
  },
})
