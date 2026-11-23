import { logger } from '@/server/observability/logger'
import { NextRequest, NextResponse } from 'next/server'
import { NATIVE_RUN_RETIRED_CODE, NATIVE_RUN_RETIRED_MESSAGE } from '@/shared/agents/native-run-retirement'
import { HookNotFoundError } from 'workflow/internal/errors'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import { getAuthorizedResourceUserId } from '@/server/app-api/bff-context'
import { getOverlayServerContext } from '@/server/bootstrap'
import { readValidatedJson } from '@/server/app-api/validated-input'
import { AgentRunApprovalRequest } from '@/shared/schemas/chat'
import { asConversationId } from '@/server/conversations/ActConversationRepository'
import { submitAgentRunApproval } from '@/server/agents/submit-agent-run-approval'
import type { ConvexHarnessRepository } from '@/server/harness/ConvexHarnessRepository'

type ApprovalRepositories = ReturnType<typeof getOverlayServerContext>['appData']['repositories']
type ApprovalRouteDependencies = {
  conversations: Pick<ApprovalRepositories['conversations'], 'getConversationById' | 'getLatestAgentRun'>
  collaboration: Pick<ApprovalRepositories['conversationCollaboration'], 'getAccessibleConversation'>
  resume: (token: string, decision: { approved: boolean; reason?: string }) => Promise<unknown>
  submitWaitReply?: ConvexHarnessRepository['submitWaitReply']
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
    let conversation = await conversations.getConversationById({
      conversationId: asConversationId(body.data.conversationId),
      userId: actorUserId,
      workspaceId: context.workspace.workspace.id,
    })
    if (!conversation || (conversation.conversationType ?? 'personal') !== 'personal') {
      conversation = await collaboration.getAccessibleConversation({
        actorUserId,
        conversationId: body.data.conversationId,
        workspaceId: context.workspace.workspace.id,
      })
    }
    if (!conversation || (conversation.workspaceId !== undefined
      && conversation.workspaceId !== context.workspace.workspace.id)) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
    const access = await submitAgentRunApproval({
      actorUserId,
      workspaceId: context.workspace.workspace.id,
      conversationId: body.data.conversationId,
      agentRunId: body.data.agentRunId,
      token: body.data.token,
      decision: { approved: body.data.approved, ...(body.data.reason ? { reason: body.data.reason } : {}) },
    }, {
      getLatestAgentRun: (args) => conversations.getLatestAgentRun(args),
      ...(dependencies ? { resume: dependencies.resume, submitWaitReply: dependencies.submitWaitReply ?? null } : {}),
    })
    if (access === 'inactive') {
      return NextResponse.json({ error: 'This approval request is no longer active.' }, { status: 409 })
    }
    if (access === 'initiator-only') {
      return NextResponse.json({ error: 'Only the initiating user can approve this run.' }, { status: 403 })
    }
    if (access === 'retired') {
      return NextResponse.json({ error: NATIVE_RUN_RETIRED_MESSAGE, code: NATIVE_RUN_RETIRED_CODE }, { status: 410 })
    }
    return NextResponse.json({ success: true })
  } catch (error) {
    if (HookNotFoundError.is(error)) {
      return NextResponse.json({ error: 'This approval request is no longer active.' }, { status: 409 })
    }
    logger.error('[conversations/run/approval POST]', error)
    return NextResponse.json({ error: 'Could not submit approval.' }, { status: 500 })
  }
}
