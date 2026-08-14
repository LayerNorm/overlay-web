import { logger } from '@/server/observability/logger'
import { NextRequest, NextResponse } from 'next/server'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import { getAuthorizedResourceUserId } from '@/server/app-api/bff-context'
import { getOverlayServerContext } from '@/server/bootstrap'
import type { Id } from '../../../../../../convex/_generated/dataModel'

export async function GET(request: NextRequest, context: AppApiRouteContext) {
  try {
    const conversationId = request.nextUrl.searchParams.get('conversationId')?.trim()
    if (!conversationId) {
      return NextResponse.json({ error: 'conversationId is required' }, { status: 400 })
    }
    const run = await getOverlayServerContext().appData.repositories.conversations.getLatestAgentRun({
      conversationId: conversationId as Id<'conversations'>,
      userId: getAuthorizedResourceUserId(context),
    })
    return NextResponse.json({ run })
  } catch (error) {
    logger.error('[conversations/run GET]', error)
    const message = error instanceof Error ? error.message : 'Failed to load AgentRun'
    if (message === 'Unauthorized') {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
