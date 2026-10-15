import { logger } from '@/server/observability/logger'
import { NextRequest, NextResponse } from 'next/server'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import { getAuthorizedResourceUserId } from '@/server/app-api/bff-context'
import { getOverlayServerContext } from '@/server/bootstrap'
import { asConversationId } from '@/server/conversations/ActConversationRepository'
import { summarizeRemoteRunStreamStats } from '@/shared/agents/remote-run-stream-stats'

export async function GET(request: NextRequest, context: AppApiRouteContext) {
  try {
    const conversationId = request.nextUrl.searchParams.get('conversationId')?.trim()
    if (!conversationId) {
      return NextResponse.json({ error: 'conversationId is required' }, { status: 400 })
    }
    const run = await getOverlayServerContext().appData.repositories.conversations.getLatestAgentRun({
      conversationId: asConversationId(conversationId),
      userId: getAuthorizedResourceUserId(context),
    })
    // Remote runs also report how they streamed, including the silence so far while still active.
    const streamSummary = run?.runner === 'remote'
      ? summarizeRemoteRunStreamStats(run.streamStats, Date.now(), !['completed', 'failed', 'cancelled'].includes(run.status))
      : undefined
    return NextResponse.json({ run, ...(streamSummary ? { streamSummary } : {}) })
  } catch (error) {
    logger.error('[conversations/run GET]', error)
    const message = error instanceof Error ? error.message : 'Failed to load AgentRun'
    if (message === 'Unauthorized') {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
