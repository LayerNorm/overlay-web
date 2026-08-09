import 'server-only'

import { NextRequest, NextResponse } from 'next/server'
import { resumeHook } from 'workflow/api'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import { automationService } from '@/server/automations/http'
import { logger } from '@/server/observability/logger'

// ---------------------------------------------------------------------------
// POST /api/v1/automations/{id}/approve
//
// Resumes an automation workflow that is suspended on an approval hook.
// The request body must contain:
//   - token: the approval hook token (from buildApprovalToken)
//   - approved: boolean (true to approve, false to deny)
//   - reason: optional reason for the decision
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

    const body = await request.json() as { token?: string; approved?: boolean; reason?: string }
    if (!body.token) {
      return NextResponse.json({ error: 'Approval token is required' }, { status: 400 })
    }

    // Verify the user owns this automation
    const automation = await automationService.getAutomationForExecution({
      automationId,
      userId: context.auth.userId,
    })
    if (!automation) {
      return NextResponse.json({ error: 'Automation not found' }, { status: 404 })
    }

    // Resume the workflow hook with the approval decision
    await resumeHook(body.token, {
      approved: body.approved ?? true,
      reason: body.reason,
    })

    return NextResponse.json({
      ok: true,
      automationId,
      approved: body.approved ?? true,
    })
  } catch (error) {
    logger.error('[automations/[id]/approve]', error)
    const message = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json(
      { error: 'Failed to resume approval hook', message },
      { status: 500 },
    )
  }
}
