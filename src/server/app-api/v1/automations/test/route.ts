import { logger } from '@/server/observability/logger'
import { NextRequest, NextResponse } from 'next/server'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import { automationErrorResponse, automationService } from '@/server/automations/http'

// POST /api/v1/automations/test — run an automation once now. Same durable
// run as POST /api/v1/automations/{id}/run; kept for API clients.
export async function POST(request: NextRequest, context: AppApiRouteContext) {
  try {
    const body = await request.json().catch((_error) => ({})) as { automationId?: string }
    const result = await automationService.startManualRun({
      automationId: body.automationId,
      userId: context.auth.userId,
      workspaceId: context.workspace.workspace.id,
    })
    return NextResponse.json({ success: true, ...result })
  } catch (error) {
    if (!(error instanceof Error && error.name === 'AutomationServiceError')) {
      logger.error('[automations/test]', error)
    }
    const response = automationErrorResponse(error, 'Failed to test automation')
    if (response.status === 500) {
      const message = error instanceof Error ? error.message : 'Unknown automation error'
      return NextResponse.json({ error: 'Failed to test automation', message }, { status: 500 })
    }
    return response
  }
}
