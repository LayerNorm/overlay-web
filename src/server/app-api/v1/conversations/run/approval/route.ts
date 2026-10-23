import { logger } from '@/server/observability/logger'
import { NextRequest, NextResponse } from 'next/server'
import { resumeHook } from 'workflow/api'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import { getAuthorizedResourceUserId } from '@/server/app-api/bff-context'
import { getOverlayServerContext } from '@/server/bootstrap'
import { readValidatedJson } from '@/server/app-api/validated-input'
import { AgentRunApprovalRequest } from '@/shared/schemas/chat'
import { asConversationId } from '@/server/conversations/ActConversationRepository'
import { agentRunApprovalAccess } from '@/server/agents/agent-approval-authority'

export async function POST(request: NextRequest, context: AppApiRouteContext) {
  try {
    const body = await readValidatedJson(request, context, AgentRunApprovalRequest)
    if (!body.ok) return body.response
    const run = await getOverlayServerContext().appData.repositories.conversations.getLatestAgentRun({
      conversationId: asConversationId(body.data.conversationId),
      agentRunId: body.data.agentRunId,
      userId: getAuthorizedResourceUserId(context),
    })
    const access = agentRunApprovalAccess(run, {
      actorUserId: getAuthorizedResourceUserId(context),
      agentRunId: body.data.agentRunId,
      conversationId: body.data.conversationId,
      token: body.data.token,
    })
    if (access === 'inactive') {
      return NextResponse.json({ error: 'This approval request is no longer active.' }, { status: 409 })
    }
    if (access === 'initiator-only') {
      return NextResponse.json({ error: 'Only the initiating user can approve this run.' }, { status: 403 })
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
