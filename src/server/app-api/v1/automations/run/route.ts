import { logger } from '@/server/observability/logger'
import { NextRequest, NextResponse } from 'next/server'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import { automationErrorResponse, automationService } from '@/server/automations/http'
import { getServiceAuthHeaderName, verifyServiceAuthToken } from '@/server/auth/service-auth'
import { consumeServiceAuthReplayNonce } from '@/server/auth/service-auth-replay'
import { getInternalApiBaseUrl } from '@/server/web/app-url'

export const maxDuration = 800

async function resolveAutomationRunServiceAuth(
  request: NextRequest,
  context?: AppApiRouteContext,
): Promise<{ userId: string } | null> {
  if (context?.auth.authType === 'service') {
    return { userId: context.auth.userId }
  }

  const serviceAuthHeader = request.headers.get(getServiceAuthHeaderName())
  if (!serviceAuthHeader) return null
  return await verifyServiceAuthToken(
    serviceAuthHeader,
    {
      method: request.method,
      path: request.nextUrl.pathname,
      replayConsumer: consumeServiceAuthReplayNonce,
    },
  )
}

export async function POST(request: NextRequest, context?: AppApiRouteContext) {
  try {
    const serviceAuth = await resolveAutomationRunServiceAuth(request, context)
    if (!serviceAuth) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json() as { runId?: string }
    // Scheduler-claimed runs execute through the same durable one-shot
    // workflow as manual runs — the workflow steps own run-status settlement,
    // so the caller must not mark completion on dispatch.
    const result = await automationService.startDurableScheduledRun({
      runId: body.runId,
      serviceUserId: serviceAuth.userId,
      baseUrl: getInternalApiBaseUrl(request),
    })

    return NextResponse.json(result)
  } catch (error) {
    if (!(error instanceof Error && error.name === 'AutomationServiceError')) {
      logger.error('[automations/run]', error)
    }
    const response = automationErrorResponse(error, 'Failed to run automation')
    if (response.status === 500) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      return NextResponse.json(
        {
          error: 'Failed to run automation',
          message,
        },
        { status: 500 },
      )
    }
    return response
  }
}
