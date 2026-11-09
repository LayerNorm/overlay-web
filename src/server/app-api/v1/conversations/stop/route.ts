import { logger } from '@/server/observability/logger'
import { after, NextRequest, NextResponse } from 'next/server'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import { getOverlayServerContext } from '@/server/bootstrap'
import { getAuthorizedResourceUserId } from '@/server/app-api/bff-context'
import { abortToolLoopRunIds } from '@/server/conversations/tool-loop-run-registry'
import { actConversationRepository, agentRunService } from '@/server/conversations/http'
import type { Id } from '../../../../../../convex/_generated/dataModel'
import { asConversationId } from '@/server/conversations/ActConversationRepository'
import { cancelHarnessWorkflow } from '@/server/harness/workflow-cancellation'
import { cancelPersonalHarnessWorkflows } from '@/server/harness/personal-cancellation'

type StopRouteDependencies = {
  conversations: Pick<ReturnType<typeof getOverlayServerContext>['appData']['repositories']['conversations'], 'cancelAgentRuns'>
  getLatestAgentRun?: typeof actConversationRepository.getLatestAgentRun
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

type CancelledAgentRuns = Awaited<ReturnType<StopRouteDependencies['conversations']['cancelAgentRuns']>>
type StopRouteServer = ReturnType<typeof getOverlayServerContext>

async function cancelRemoteRuns(input: {
  runIds: string[]
  dependencies?: StopRouteDependencies
  server?: StopRouteServer
  context: AppApiRouteContext
  conversationId: string
}) {
  const controlRemoteTurn = input.dependencies?.controlRemoteTurn
    ?? ((value) => input.server!.connectedAgentControlPlane.controlRemoteTurn(value))
  await Promise.all(input.runIds.map((runId) => controlRemoteTurn({
    actorUserId: input.context.auth.userId,
    workspaceId: input.context.workspace.workspace.id,
    conversationId: input.conversationId,
    runId,
    action: 'cancel',
  }).catch((error) => {
    logger.warn('[conversations/stop POST] Failed to cancel remote run', { runId, error })
  })))
}

async function cancelWorkflowRuns(
  runs: CancelledAgentRuns['cancelledWorkflows'],
  dependencies?: StopRouteDependencies,
): Promise<string[]> {
  const cancelWorkflow = dependencies?.cancelWorkflow ?? cancelHarnessWorkflow
  return (await Promise.all(runs.map(async (run) => {
    try {
      await cancelWorkflow(run.workflowRunId)
      return run.agentRunId
    } catch (error) {
      logger.warn('[conversations/stop POST] Failed to cancel workflow run', { runId: run.workflowRunId, error })
      return null
    }
  }))).filter((runId): runId is string => Boolean(runId))
}

async function recordCancellationMetrics(input: {
  runIds: string[]
  userId: string
  acknowledgedAt: number
  dependencies?: StopRouteDependencies
}) {
  const recordMetrics = input.dependencies?.recordMetrics
    ?? ((runId: string, userId: string, acknowledgedAt: number) => agentRunService.recordMetrics({
      metrics: { cancellationAcknowledgedAt: acknowledgedAt }, runId, userId,
    }))
  await Promise.all(input.runIds.map((runId) =>
    recordMetrics(runId, input.userId, input.acknowledgedAt).catch((_error) => undefined)))
}

function scheduleHarnessCleanup(input: {
  roots: NonNullable<CancelledAgentRuns['cancelledHarnessRoots']>
  userId: string
  dependencies?: StopRouteDependencies
}) {
  const schedule = input.dependencies?.schedule ?? after
  const cancelHarnessWorkflows = input.dependencies?.cancelHarnessWorkflows ?? cancelPersonalHarnessWorkflows
  for (const root of input.roots) {
    schedule(async () => {
      try {
        await cancelHarnessWorkflows({
          actorUserId: input.userId,
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
}

async function completeCancellation(input: {
  cancelled: CancelledAgentRuns
  dependencies?: StopRouteDependencies
  server?: StopRouteServer
  context: AppApiRouteContext
  conversationId: string
  userId: string
}) {
  await cancelRemoteRuns({
    runIds: input.cancelled.remoteRunIds ?? [],
    dependencies: input.dependencies,
    server: input.server,
    context: input.context,
    conversationId: input.conversationId,
  })
  const abortedLocalRunIds = (input.dependencies?.abortToolLoops ?? abortToolLoopRunIds)(input.cancelled.cancelledRunIds)
  const cancelledWorkflowAgentRunIds = await cancelWorkflowRuns(input.cancelled.cancelledWorkflows, input.dependencies)
  const cancellationAcknowledgedAt = Date.now()
  await recordCancellationMetrics({
    runIds: [...abortedLocalRunIds, ...cancelledWorkflowAgentRunIds],
    userId: input.userId,
    acknowledgedAt: cancellationAcknowledgedAt,
    dependencies: input.dependencies,
  })
  scheduleHarnessCleanup({
    roots: input.cancelled.cancelledHarnessRoots ?? [],
    userId: input.userId,
    dependencies: input.dependencies,
  })
  return { abortedLocalRunIds, cancelledWorkflowAgentRunIds }
}

export async function POST(
  request: NextRequest,
  context: AppApiRouteContext,
  dependencies?: StopRouteDependencies,
) {
  try {
    const body = await request.json() as {
      conversationId?: string
      turnId?: string
      messageId?: string
      partialContent?: string
      partialParts?: Array<Record<string, unknown>>
      accessToken?: string
      userId?: string
    }

    if (body.turnId !== undefined
      && (typeof body.turnId !== 'string' || !body.turnId.trim() || body.turnId.length > 256)) {
      return NextResponse.json({ error: 'turnId is invalid' }, { status: 400 })
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
    let messageId = body.messageId
    if (body.turnId) {
      const getLatestAgentRun = dependencies?.getLatestAgentRun
        ?? actConversationRepository.getLatestAgentRun.bind(actConversationRepository)
      const agentRun = await getLatestAgentRun({
        conversationId: asConversationId(conversationId),
        turnId: body.turnId,
        userId: resourceUserId,
      })
      if (!agentRun) return NextResponse.json({ error: 'Turn was not found.' }, { status: 404 })
      messageId = agentRun.assistantMessageId
    }
    const cancelled = await repository.cancelAgentRuns({
      conversationId: asConversationId(conversationId),
      ...(messageId ? { messageId: messageId as Id<'conversationMessages'> } : {}),
      ...(body.partialContent !== undefined ? { partialContent: body.partialContent } : {}),
      ...(body.partialParts !== undefined ? { partialParts: body.partialParts } : {}),
      userId: resourceUserId,
    })
    const { abortedLocalRunIds, cancelledWorkflowAgentRunIds } = await completeCancellation({
      cancelled,
      dependencies,
      server,
      context,
      conversationId,
      userId: resourceUserId,
    })
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
