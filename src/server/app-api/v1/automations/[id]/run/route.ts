import 'server-only'

import { NextRequest, NextResponse } from 'next/server'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import { automationErrorResponse, automationService } from '@/server/automations/http'
import { logger } from '@/server/observability/logger'

// POST /api/v1/automations/{id}/run — start a manual run through the same
// durable run workflow scheduled runs use.
export async function POST(_request: NextRequest, context?: AppApiRouteContext) {
  try {
    const automationId = (await context?.params ?? {})['id'] as string | undefined
    if (!automationId) {
      return NextResponse.json({ error: 'Automation ID is required' }, { status: 400 })
    }
    if (!context?.auth.userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    return NextResponse.json(await automationService.startManualRun({
      automationId,
      userId: context.auth.userId,
      workspaceId: context.workspace.workspace.id,
    }))
  } catch (error) {
    if (!(error instanceof Error && error.name === 'AutomationServiceError')) {
      logger.error('[automations/[id]/run]', error)
    }
    const response = automationErrorResponse(error, 'Failed to start automation run')
    if (response.status === 500) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      return NextResponse.json({ error: 'Failed to start automation run', message }, { status: 500 })
    }
    return response
  }
}
