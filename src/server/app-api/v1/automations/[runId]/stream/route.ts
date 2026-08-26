import 'server-only'

import { NextRequest, NextResponse } from 'next/server'
import { getRun } from 'workflow/api'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import { logger } from '@/server/observability/logger'

// ---------------------------------------------------------------------------
// GET /api/v1/automations/{id}/stream
//
// Returns the current status of a durable automation run. The id here
// is the workflow run ID (not the automation run ID). The app-level route
// uses [id] (not [runId]) to satisfy Next.js's consistent-slug requirement.
// ---------------------------------------------------------------------------

export async function GET(_request: NextRequest, context?: AppApiRouteContext) {
  try {
    const params = await context?.params ?? {}
    const workflowRunId = (params['runId'] ?? params['id']) as string | undefined
    if (!workflowRunId) {
      return NextResponse.json({ error: 'runId is required' }, { status: 400 })
    }

    if (!context?.auth.userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const run = getRun(workflowRunId)
    const status = await run.status
    const workflowName = await run.workflowName

    let result: { conversationId?: string; runId?: string } | undefined
    if (status === 'completed') {
      try {
        const returnValue = await run.returnValue
        result = returnValue as { conversationId?: string; runId?: string }
      } catch (_error) {
        // Return value may not be available if the run failed
      }
    }

    let error: string | undefined
    if (status === 'failed') {
      try {
        // returnValue may throw or contain error info when the run failed
        const returnValue = await run.returnValue
        error = typeof returnValue === 'string' ? returnValue : JSON.stringify(returnValue)
      } catch (e) {
        error = e instanceof Error ? e.message : 'Workflow failed'
      }
    }

    return NextResponse.json({
      workflowRunId,
      status,
      workflowName,
      result,
      error,
    })
  } catch (error) {
    logger.error('[automations/[runId]/stream]', error)
    const message = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json(
      { error: 'Failed to get workflow status', message },
      { status: 500 },
    )
  }
}
