import { logger } from '@/server/observability/logger'
import { after, NextRequest, NextResponse } from 'next/server'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import { getOverlayServerContext } from '@/server/bootstrap'
import { getAuthorizedResourceUserId } from '@/server/app-api/bff-context'
import { abortToolLoopRunIds } from '@/server/conversations/tool-loop-run-registry'
import { agentRunService } from '@/server/conversations/http'
import type { Id } from '../../../../../../convex/_generated/dataModel'
import { asConversationId } from '@/server/conversations/ActConversationRepository'
import { getRun } from 'workflow/api'
import { cancelPersonalHarnessWorkflows } from '@/server/harness/personal-cancellation'

type StopRouteDependencies = {
  conversations: Pick<ReturnType<typeof getOverlayServerContext>['appData']['repositories']['conversations'], 'cancelAgentRuns'>
  controlRemoteTurn?: (input: {
    actorUserId: string
    workspaceId: string
    conversationId: string
    runId: string
    action: 'cancel'
  }) => Promise<unknown>
  abortToolLoops?: typeof abortToolLoopRunIds
  cancelWorkflow?: (workflowRunId: string) => Promise<void>
  recordMetrics?: (runId: string, userId: string, cancellationAcknowledgedAt: number) => Promise<unknown>
  schedule?: typeof after
  cancelHarnessWorkflows?: typeof cancelPersonalHarnessWorkflows
}

export async function POST(
  request: NextRequest,
  context: AppApiRouteContext,
  dependencies?: StopRouteDependencies,
) {
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

    const server = dependencies ? undefined : getOverlayServerContext()
    const repository = dependencies?.conversations ?? server!.appData.repositories.conversations
    const resourceUserId = getAuthorizedResourceUserId(context)
    const cancelled = await repository.cancelAgentRuns({
      conversationId: asConversationId(conversationId),
      ...(body.messageId ? { messageId: body.messageId as Id<'conversationMessages'> } : {}),
      ...(body.partialContent !== undefined ? { partialContent: body.partialContent } : {}),
      ...(body.partialParts !== undefined ? { partialParts: body.partialParts } : {}),
      userId: resourceUserId,
    })
    // Connected agents (Claude Code, Codex…) are stopped through the control plane, which tells their machine to cancel.
    const remoteRunIds = cancelled.remoteRunIds ?? []
    const controlRemoteTurn = dependencies?.controlRemoteTurn
      ?? (input => server!.connectedAgentControlPlane.controlRemoteTurn(input))
    await Promise.all(remoteRunIds.map((runId) => controlRemoteTurn({
      actorUserId: context.auth.userId,
      workspaceId: context.workspace.workspace.id,
      conversationId,
      runId,
      action: 'cancel',
    }).catch((error) => {
      logger.warn('[conversations/stop POST] Failed to cancel remote run', { runId, error })
    })))
    const abortedLocalRunIds = (dependencies?.abortToolLoops ?? abortToolLoopRunIds)(cancelled.cancelledRunIds)
    const cancelWorkflow = dependencies?.cancelWorkflow
      ?? (async (workflowRunId: string) => { await getRun(workflowRunId).cancel() })
    const cancelledWorkflowAgentRunIds = (await Promise.all(cancelled.cancelledWorkflows.map(async (run) => {
      try {
        await cancelWorkflow(run.workflowRunId)
        return run.agentRunId
      } catch (error) {
        logger.warn('[conversations/stop POST] Failed to cancel workflow run', { runId: run.workflowRunId, error })
        return null
      }
    }))).filter((runId): runId is string => Boolean(runId))
    const cancellationAcknowledgedAt = Date.now()
    const recordMetrics = dependencies?.recordMetrics
      ?? (async (runId: string, userId: string, acknowledgedAt: number) => agentRunService.recordMetrics({
        metrics: { cancellationAcknowledgedAt: acknowledgedAt }, runId, userId,
      }))
    await Promise.all([...abortedLocalRunIds, ...cancelledWorkflowAgentRunIds].map((runId) =>
      recordMetrics(runId, resourceUserId, cancellationAcknowledgedAt).catch((_error) => undefined)))
    const schedule = dependencies?.schedule ?? after
    const cancelHarnessWorkflows = dependencies?.cancelHarnessWorkflows ?? cancelPersonalHarnessWorkflows
    for (const root of cancelled.cancelledHarnessRoots ?? []) {
      schedule(async () => {
        try {
          await cancelHarnessWorkflows({
            actorUserId: resourceUserId,
            agentRunId: root.agentRunId,
            rootRunId: root.runId,
          })
        } catch (error) {
          logger.warn('[conversations/stop POST] Failed to clean up personal harness workflows', {
            agentRunId: root.agentRunId, rootRunId: root.runId, error,
          })
        }
      })
    }
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
