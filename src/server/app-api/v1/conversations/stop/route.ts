import { logger } from '@/server/observability/logger'
import { NextRequest, NextResponse } from 'next/server'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import { getOverlayServerContext } from '@/server/bootstrap'
import { getAuthorizedResourceUserId } from '@/server/app-api/bff-context'
import { abortToolLoopRunIds } from '@/server/conversations/tool-loop-run-registry'
import { agentRunService } from '@/server/conversations/http'
import type { Id } from '../../../../../../convex/_generated/dataModel'
import { getRun } from 'workflow/api'

export async function POST(request: NextRequest, context: AppApiRouteContext) {
  try {
    const body = await request.json() as {
      conversationId?: string
      messageId?: string
      partialContent?: string
      partialParts?: Array<Record<string, unknown>>
      accessToken?: string
      userId?: string
    }

    const conversationId = body.conversationId?.trim()
    if (!conversationId) {
      return NextResponse.json(
        { error: 'conversationId is required' },
        { status: 400 },
      )
    }

    const repository = getOverlayServerContext().appData.repositories.conversations
    const resourceUserId = getAuthorizedResourceUserId(context)
    const cancelled = await repository.cancelAgentRuns({
      conversationId: conversationId as Id<'conversations'>,
      ...(body.messageId ? { messageId: body.messageId as Id<'conversationMessages'> } : {}),
      ...(body.partialContent !== undefined ? { partialContent: body.partialContent } : {}),
      ...(body.partialParts !== undefined ? { partialParts: body.partialParts } : {}),
      userId: resourceUserId,
    })
    const abortedLocalRunIds = abortToolLoopRunIds(cancelled.cancelledRunIds)
    const cancelledWorkflowAgentRunIds = (await Promise.all(cancelled.cancelledWorkflows.map(async (run) => {
      try {
        await getRun(run.workflowRunId).cancel()
        return run.agentRunId
      } catch (error) {
        logger.warn('[conversations/stop POST] Failed to cancel workflow run', { runId: run.workflowRunId, error })
        return null
      }
    }))).filter((runId): runId is string => Boolean(runId))
    const cancellationAcknowledgedAt = Date.now()
    await Promise.all([...abortedLocalRunIds, ...cancelledWorkflowAgentRunIds].map((runId) =>
      agentRunService.recordMetrics({
        metrics: { cancellationAcknowledgedAt },
        runId,
        userId: resourceUserId,
      }).catch((_error) => undefined)))
    return NextResponse.json({
      success: true,
      stoppedCount: cancelled.stoppedCount,
      cancelledRunIds: cancelled.cancelledRunIds,
      abortedLocalCount: abortedLocalRunIds.length,
      cancelledWorkflowCount: cancelledWorkflowAgentRunIds.length,
    })
  } catch (e) {
    logger.error('[conversations/stop POST]', e)
    const msg = e instanceof Error ? e.message : 'Failed to stop generating message'
    if (msg === 'Unauthorized') {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
