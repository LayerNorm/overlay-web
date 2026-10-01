import 'server-only'

import { NextRequest, NextResponse } from 'next/server'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import { automationService } from '@/server/automations/http'
import { logger } from '@/server/observability/logger'

// ---------------------------------------------------------------------------
// POST /api/v1/automations/{id}/start-scheduler
//
// DEPRECATED — kept as a backwards-compatible no-op. Scheduled execution is
// owned by the minute cron (`convex/crons.ts` → claimDueRuns), which claims due
// runs and dispatches each
// through the durable one-shot workflow. The old sleep()-based per-automation
// scheduler workflow could not survive deployments (no durable workflow world)
// and would double-fire next to the cron.
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest, context?: AppApiRouteContext) {
  try {
    const automationId = (await context?.params ?? {})['id'] as string | undefined
    if (!automationId) {
      return NextResponse.json({ error: 'Automation ID is required' }, { status: 400 })
    }

    if (!context?.auth.userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const userId = context.auth.userId

    const automation = await automationService.getAutomationForExecution({
      automationId,
      userId,
    })
    if (!automation) {
      return NextResponse.json({ error: 'Automation not found' }, { status: 404 })
    }

    return NextResponse.json({
      ok: true,
      automationId,
      scheduler: 'cron',
      deprecated: true,
    })
  } catch (error) {
    logger.error('[automations/[id]/start-scheduler]', error)
    const message = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json(
      { error: 'Failed to start scheduler', message },
      { status: 500 },
    )
  }
}

