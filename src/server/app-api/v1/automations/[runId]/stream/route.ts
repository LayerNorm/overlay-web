import 'server-only'

import { NextRequest, NextResponse } from 'next/server'
import { getRun } from 'workflow/api'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import { logger } from '@/server/observability/logger'

// ---------------------------------------------------------------------------
// GET /api/v1/automations/{runId}/stream
//
// Returns the current status of a durable automation run. The runId here
// is the workflow run ID (not the automation run ID).
// ---------------------------------------------------------------------------

export async function GET(_request: NextRequest, context?: AppApiRouteContext) {
  try {
    const workflowRunId = (await context?.params ?? {})['runId'] as string | undefined
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
      } catch {
        // Return value may not be available if the run failed
      }
    }

    return NextResponse.json({
      workflowRunId,
      status,
      workflowName,
      result,
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
