import { logger } from '@/server/observability/logger'
import { NextRequest, NextResponse } from 'next/server'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import { getAuthorizedResourceUserId } from '@/server/app-api/bff-context'
import { readValidatedQuery } from '@/server/app-api/validated-input'
import { AgentRunMetricsQuery } from '@/shared/schemas/chat'
import { agentRunService } from '@/server/conversations/http'

const DEFAULT_WINDOW_MS = 30 * 24 * 60 * 60 * 1_000

export async function GET(request: NextRequest, context: AppApiRouteContext) {
  try {
    const query = readValidatedQuery(request, context, AgentRunMetricsQuery)
    if (!query.ok) return query.response
    const to = query.data.to ?? Date.now()
    const from = query.data.from ?? Math.max(0, to - DEFAULT_WINDOW_MS)
    if (from > to) {
      return NextResponse.json({ error: 'from must be less than or equal to to' }, { status: 400 })
    }
    const report = await agentRunService.metricsReport({
      from,
      limit: query.data.limit,
      to,
      userId: getAuthorizedResourceUserId(context),
    })
    return NextResponse.json(report)
  } catch (error) {
    logger.error('[conversations/run/metrics GET]', error)
    return NextResponse.json({ error: 'Failed to load AgentRun metrics' }, { status: 500 })
  }
}
