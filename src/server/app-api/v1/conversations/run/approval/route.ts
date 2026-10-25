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

type ApprovalRepositories = ReturnType<typeof getOverlayServerContext>['appData']['repositories']
type ApprovalRouteDependencies = {
  conversations: Pick<ApprovalRepositories['conversations'], 'getConversationById' | 'getLatestAgentRun'>
  collaboration: Pick<ApprovalRepositories['conversationCollaboration'], 'getAccessibleConversation'>
  resume: (token: string, decision: { approved: boolean; reason?: string }) => Promise<unknown>
}

export async function POST(
  request: NextRequest,
  context: AppApiRouteContext,
  dependencies?: ApprovalRouteDependencies,
) {
  try {
    const body = await readValidatedJson(request, context, AgentRunApprovalRequest)
    if (!body.ok) return body.response
    const repositories = dependencies ? null : getOverlayServerContext().appData.repositories
    const conversations = dependencies?.conversations ?? repositories!.conversations
    const collaboration = dependencies?.collaboration ?? repositories!.conversationCollaboration
    const actorUserId = getAuthorizedResourceUserId(context)
    const conversation = await conversations.getConversationById({
      conversationId: asConversationId(body.data.conversationId),
      userId: actorUserId,
    }) ?? await collaboration.getAccessibleConversation({
      actorUserId,
      conversationId: body.data.conversationId,
      workspaceId: context.workspace.workspace.id,
    })
    if (!conversation) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
    const run = await conversations.getLatestAgentRun({
      conversationId: asConversationId(body.data.conversationId),
      agentRunId: body.data.agentRunId,
      userId: actorUserId,
    })
    const access = agentRunApprovalAccess(run, {
      actorUserId,
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
    const resume = dependencies?.resume ?? resumeHook
    await resume(body.data.token, {
      approved: body.data.approved,
      ...(body.data.reason ? { reason: body.data.reason } : {}),
    })
    return NextResponse.json({ success: true })
  } catch (error) {
    logger.error('[conversations/run/approval POST]', error)
    return NextResponse.json({ error: 'Could not submit approval.' }, { status: 500 })
  }
}
