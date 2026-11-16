import { logger } from '@/server/observability/logger'
import { NextRequest, NextResponse } from 'next/server'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import { automationErrorResponse, automationService } from '@/server/automations/http'
import { getServiceAuthHeaderName, verifyServiceAuthToken } from '@/server/auth/service-auth'
import { consumeServiceAuthReplayNonce } from '@/server/auth/service-auth-replay'

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
    if (!serviceAuth || !context || context.auth.userId !== serviceAuth.userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json().catch((_error) => ({})) as { runId?: string }
    // Scheduler-claimed runs post their instructions into the automation's
    // thread, the same as Run now. Once the thread's turn ends, the scheduler
    // calls again and the run settles from that turn's outcome.
    const result = await automationService.dispatchScheduledRun({
      runId: body.runId ?? (typeof context.parsedJson.runId === 'string' ? context.parsedJson.runId : undefined),
      serviceUserId: serviceAuth.userId,
      routeContext: context,
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
