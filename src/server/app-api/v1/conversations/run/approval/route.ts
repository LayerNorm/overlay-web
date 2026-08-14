import { logger } from '@/server/observability/logger'
import { NextRequest, NextResponse } from 'next/server'
import { resumeHook } from 'workflow/api'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import { getAuthorizedResourceUserId } from '@/server/app-api/bff-context'
import { getOverlayServerContext } from '@/server/bootstrap'
import { readValidatedJson } from '@/server/app-api/validated-input'
import { AgentRunApprovalRequest } from '@/shared/schemas/chat'
import type { Id } from '../../../../../../../convex/_generated/dataModel'

export async function POST(request: NextRequest, context: AppApiRouteContext) {
  try {
    const body = await readValidatedJson(request, context, AgentRunApprovalRequest)
    if (!body.ok) return body.response
    const run = await getOverlayServerContext().appData.repositories.conversations.getLatestAgentRun({
      conversationId: body.data.conversationId as Id<'conversations'>,
      userId: getAuthorizedResourceUserId(context),
    })
    if (
      !run ||
      run.id !== body.data.agentRunId ||
      run.status !== 'waiting_for_approval' ||
      run.approval?.token !== body.data.token
    ) {
      return NextResponse.json({ error: 'This approval request is no longer active.' }, { status: 409 })
    }
    await resumeHook(body.data.token, {
      approved: body.data.approved,
      ...(body.data.reason ? { reason: body.data.reason } : {}),
    })
    return NextResponse.json({ success: true })
  } catch (error) {
    logger.error('[conversations/run/approval POST]', error)
    return NextResponse.json({ error: 'Could not submit approval.' }, { status: 500 })
  }
}
