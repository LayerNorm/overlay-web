import { logger } from '@/server/observability/logger'
import { NextRequest, NextResponse } from 'next/server'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import { getAuthorizedResourceUserId } from '@/server/app-api/bff-context'
import { readValidatedJson } from '@/server/app-api/validated-input'
import { AgentRunMetricEventRequest } from '@/shared/schemas/chat'
import { agentRunService } from '@/server/conversations/http'
import type { Id } from '../../../../../../../convex/_generated/dataModel'

export async function POST(request: NextRequest, context: AppApiRouteContext) {
  try {
    const body = await readValidatedJson(request, context, AgentRunMetricEventRequest)
    if (!body.ok) return body.response
    const userId = getAuthorizedResourceUserId(context)
    const recorded = await agentRunService.recordBrowserEvent({
      conversationId: body.data.conversationId as Id<'conversations'>,
      event: body.data.event,
      runId: body.data.agentRunId,
      userId,
    })
    if (!recorded) {
      return NextResponse.json({ error: 'AgentRun not found' }, { status: 404 })
    }
    return NextResponse.json({ success: true })
  } catch (error) {
    logger.error('[conversations/run/metrics-event POST]', error)
    return NextResponse.json({ error: 'Failed to record AgentRun metric event' }, { status: 500 })
  }
}
