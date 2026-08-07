import { logger } from '@/server/observability/logger'
import { NextRequest, NextResponse } from 'next/server'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import { automationErrorResponse, automationService } from '@/server/automations/http'
import { getInternalApiBaseUrl } from '@/server/web/app-url'

export const maxDuration = 800

export async function POST(request: NextRequest, context: AppApiRouteContext) {
  try {
    const body = await request.json().catch((_error) => ({})) as {
      accessToken?: string
      userId?: string
      automationId?: string
    }
    const { auth } = context
    const result = await automationService.testAutomation({
      automationId: body.automationId,
      userId: auth.userId,
      baseUrl: getInternalApiBaseUrl(request),
    })
    return NextResponse.json(result)
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
