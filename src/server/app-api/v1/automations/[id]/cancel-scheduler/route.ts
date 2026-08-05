import 'server-only'

import { NextRequest, NextResponse } from 'next/server'
import { getRun } from 'workflow/api'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import { automationService } from '@/server/automations/http'
import { logger } from '@/server/observability/logger'

export async function POST(request: NextRequest, context?: AppApiRouteContext) {
  try {
    const automationId = (await context?.params ?? {})['id'] as string | undefined
    if (!automationId) {
      return NextResponse.json({ error: 'Automation ID is required' }, { status: 400 })
    }
    if (!context?.auth.userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const automation = await automationService.getAutomationForExecution({
      automationId,
      userId: context.auth.userId,
    })
    if (!automation) {
      return NextResponse.json({ error: 'Automation not found' }, { status: 404 })
    }

    const body = await request.json() as { workflowRunId?: string }
    if (!body.workflowRunId) {
      return NextResponse.json({ error: 'workflowRunId is required' }, { status: 400 })
    }

    await getRun(body.workflowRunId).cancel()
    return NextResponse.json({ ok: true, automationId, workflowRunId: body.workflowRunId })
  } catch (error) {
    logger.error('[automations/[id]/cancel-scheduler]', error)
    const message = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json(
      { error: 'Failed to cancel scheduler', message },
      { status: 500 },
    )
  }
}
