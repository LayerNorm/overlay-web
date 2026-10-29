import { v } from 'convex/values'
import { WorkflowProjectionPage } from '@/shared/schemas/workflow-projection'
import { internal } from '../_generated/api'
import { internalAction } from '../_generated/server'
import { fetchAppCallback } from '../lib/appCallback'

/** SDK state belongs to the web deployment, never the Convex action host. */
export const runProjectionTick = internalAction({
  args: {}, returns: v.null(),
  handler: async ctx => {
    const serverSecret = process.env.INTERNAL_API_SECRET
    const origin = process.env.NEXT_PUBLIC_APP_URL
    if (!serverSecret || !origin) throw new Error('Workflow projection callback is not configured')
    const runs = await ctx.runQuery(internal.automations.workflowEventProjector.listActiveWorkflowRuns, {serverSecret, limit: 20})
    await Promise.all(runs.map(async run => {
      try {
        const response = await fetchAppCallback(new URL('/api/v1/automations/project-events', origin).href, {
          method: 'POST', headers: {'content-type': 'application/json', 'x-internal-api-secret': serverSecret},
          body: JSON.stringify({workflowRunId: run.workflowRunId, cursor: run.cursor ?? null}),
          signal: AbortSignal.timeout(30_000),
        })
        if (!response.ok) throw new Error(`Projection callback HTTP ${response.status}`)
        const page = WorkflowProjectionPage.parse(await response.json())
        await ctx.runMutation(internal.automations.workflowEventProjector.recordProjectionPage, {
          serverSecret, automationRunId: run._id, workflowRunId: run.workflowRunId,
          expectedCursor: run.cursor ?? null, ...page,
        })
      } catch (error) {
        console.error('Workflow projection failed', {workflowRunId: run.workflowRunId,
          type: error instanceof Error ? error.name : 'unknown'})
      }
    }))
    return null
  },
})
