import 'server-only'

import { NextRequest, NextResponse } from 'next/server'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import { getOverlayServerContext } from '@/server/bootstrap'
import { getServiceAuthHeaderName, verifyServiceAuthToken } from '@/server/auth/service-auth'
import { consumeServiceAuthReplayNonce } from '@/server/auth/service-auth-replay'
import { DEFAULT_MODEL_ID } from '@/shared/ai/gateway/model-types'
import { logger } from '@/server/observability/logger'
import { automationService } from '@/server/automations/http'
import type { Id } from '../../../../../../convex/_generated/dataModel'

// ---------------------------------------------------------------------------
// POST /api/v1/automations/execute/prepare
//
// Internal endpoint called by the automation-run workflow's prepareExecution
// step. Creates a conversation for the automation run if one doesn't already
// exist. Service auth required.
// ---------------------------------------------------------------------------

async function resolveServiceAuth(
  request: NextRequest,
  context?: AppApiRouteContext,
): Promise<{ userId: string } | null> {
  if (context?.auth.authType === 'service') {
    return { userId: context.auth.userId }
  }
  const serviceAuthHeader = request.headers.get(getServiceAuthHeaderName())
  if (!serviceAuthHeader) return null
  return await verifyServiceAuthToken(serviceAuthHeader, {
    method: request.method,
    path: request.nextUrl.pathname,
    replayConsumer: consumeServiceAuthReplayNonce,
  })
}

export async function POST(request: NextRequest, context?: AppApiRouteContext) {
  try {
    const serviceAuth = await resolveServiceAuth(request, context)
    if (!serviceAuth) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json() as {
      action?: 'prepare' | 'mark-started'
      automationId?: string
      userId?: string
      name?: string
      projectId?: string
      modelId?: string
      conversationId?: string
      runId?: string
      turnId?: string
    }

    if (!body.userId || body.userId !== serviceAuth.userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // mark-started: update automation_runs status to 'running'
    if (body.action === 'mark-started') {
      if (!body.runId) {
        return NextResponse.json({ error: 'runId is required' }, { status: 400 })
      }
      await automationService.markRunStarted({
        runId: body.runId,
        userId: body.userId,
        conversationId: body.conversationId,
        turnId: body.turnId,
      })
      return NextResponse.json({ ok: true })
    }

    // If conversation already exists, reuse it (idempotent)
    if (body.conversationId) {
      return NextResponse.json({ conversationId: body.conversationId })
    }

    const overlayContext = getOverlayServerContext()
    // Resolve the user's active workspace so the conversation is bound to
    // the same workspace that the BFF will resolve for the act route call.
    const workspace = await overlayContext.workspaceService.resolveActiveWorkspace(body.userId)
    const title = `Automation: ${body.name ?? 'Untitled'}`
    const conversationId = await overlayContext
      .appData.repositories.conversations.createConversation({
        userId: body.userId,
        title,
        projectId: body.projectId,
        askModelIds: [body.modelId || DEFAULT_MODEL_ID],
        actModelId: body.modelId || DEFAULT_MODEL_ID,
        lastMode: 'act',
        workspaceId: workspace.workspace.id,
      })

    if (!conversationId) {
      return NextResponse.json(
        { error: 'Failed to create conversation' },
        { status: 500 },
      )
    }

    return NextResponse.json({ conversationId })
  } catch (error) {
    logger.error('[automations/execute/prepare]', error)
    return NextResponse.json(
      { error: 'Failed to prepare automation execution' },
      { status: 500 },
    )
  }
}

// ---------------------------------------------------------------------------
// POST /api/v1/automations/execute/finalize
//
// Internal endpoint called by the automation-run workflow's finalizeRun step.
// Settles generating messages for the turn. Service auth required.
// ---------------------------------------------------------------------------

export async function PATCH(request: NextRequest, context?: AppApiRouteContext) {
  try {
    const serviceAuth = await resolveServiceAuth(request, context)
    if (!serviceAuth) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json() as {
      conversationId?: string
      userId?: string
      turnId?: string
      status?: 'completed' | 'error'
      fallbackText?: string
      runId?: string
      runStatus?: 'succeeded' | 'failed'
      error?: string
    }

    if (!body.userId || body.userId !== serviceAuth.userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Update automation_runs status if runId and runStatus are provided
    if (body.runId && body.runStatus) {
      if (body.runStatus === 'succeeded') {
        await automationService.markRunCompleted({
          runId: body.runId,
          userId: body.userId,
          conversationId: body.conversationId,
        })
      } else if (body.runStatus === 'failed') {
        await automationService.markRunFailed({
          runId: body.runId,
          userId: body.userId,
          error: body.error ?? 'Automation run failed',
        })
      }
    }

    if (!body.conversationId || !body.turnId) {
      // If we already handled a run-status-only update, return ok
      if (body.runId && body.runStatus) {
        return NextResponse.json({ ok: true })
      }
      return NextResponse.json(
        { error: 'conversationId and turnId are required' },
        { status: 400 },
      )
    }

    await getOverlayServerContext().appData.repositories.conversations
      .settleGeneratingMessagesForTurn({
        conversationId: body.conversationId as Id<'conversations'>,
        userId: body.userId,
        turnId: body.turnId,
        status: body.status ?? 'completed',
        fallbackText: body.fallbackText ?? 'Automation run finished.',
      })

    return NextResponse.json({ ok: true })
  } catch (error) {
    logger.error('[automations/execute/finalize]', error)
    // Non-fatal — the act route may have already settled the turn
    return NextResponse.json({ ok: true, warning: 'finalize error' })
  }
}
