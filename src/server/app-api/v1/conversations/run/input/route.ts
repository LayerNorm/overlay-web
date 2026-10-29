import { NextRequest, NextResponse } from 'next/server'
import { resumeHook } from 'workflow/api'
import { HookNotFoundError } from 'workflow/internal/errors'
import { logger } from '@/server/observability/logger'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import { getAuthorizedResourceUserId } from '@/server/app-api/bff-context'
import { getOverlayServerContext } from '@/server/bootstrap'
import { readValidatedJson } from '@/server/app-api/validated-input'
import { asConversationId } from '@/server/conversations/ActConversationRepository'
import { AgentRunInputRequest } from '@/shared/schemas/chat'

type Repositories = ReturnType<typeof getOverlayServerContext>['appData']['repositories']
type InputRouteDependencies = {
  conversations: Pick<Repositories['conversations'], 'getConversationById' | 'getLatestAgentRun'>
  collaboration?: Pick<Repositories['conversationCollaboration'], 'getAccessibleConversation'>
  resume: (token: string, reply: { text: string }) => Promise<unknown>
}

const inactive = () => NextResponse.json({ error: 'This input request is no longer active.' }, { status: 409 })

export async function POST(request: NextRequest, context: AppApiRouteContext, dependencies?: InputRouteDependencies) {
  try {
    const body = await readValidatedJson(request, context, AgentRunInputRequest)
    if (!body.ok) return body.response
    const repositories = dependencies ? null : getOverlayServerContext().appData.repositories
    const conversations = dependencies?.conversations ?? repositories!.conversations
    const collaboration = dependencies?.collaboration ?? repositories?.conversationCollaboration
    const actorUserId = getAuthorizedResourceUserId(context)
    const conversationId = asConversationId(body.data.conversationId)
    let conversation = await conversations.getConversationById({
      conversationId, userId: actorUserId, workspaceId: context.workspace.workspace.id,
    })
    // Rooms always require current participation, even when this user created
    // the room. Hook possession never grants access after membership revocation.
    if (!conversation || (conversation.conversationType ?? 'personal') !== 'personal') {
      conversation = await collaboration?.getAccessibleConversation({
        actorUserId, conversationId, workspaceId: context.workspace.workspace.id,
      }) ?? null
    }
    const isRoom = conversation && (conversation.conversationType ?? 'personal') !== 'personal'
    if (!conversation || (!isRoom && conversation.userId !== actorUserId)
      || (conversation.workspaceId !== undefined && conversation.workspaceId !== context.workspace.workspace.id)) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
    const run = await conversations.getLatestAgentRun({ conversationId, userId: actorUserId, agentRunId: body.data.agentRunId })
    if (!run || run.id !== body.data.agentRunId || run.conversationId !== body.data.conversationId
      || run.userId !== actorUserId || (run.mode === 'room') !== Boolean(isRoom)
      || (isRoom && run.executionEngine !== 'overlay_harness')
      || run.runner !== 'workflow' || !run.workflowRunId
      || run.status !== 'waiting_for_input' || run.inputRequest?.token !== body.data.token) return inactive()
    // This is input to an existing work artifact, not a new turn. The hook
    // retains the full reply; the harness records bounded user-input evidence.
    await (dependencies?.resume ?? resumeHook)(body.data.token, { text: body.data.text })
    return NextResponse.json({ success: true })
  } catch (error) {
    if (HookNotFoundError.is(error)) return inactive()
    logger.error('[conversations/run/input POST]', error)
    return NextResponse.json({ error: 'Could not submit input.' }, { status: 500 })
  }
}
