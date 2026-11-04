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
import type { AgentRun } from '@/shared/agents/agent-run'
import { isRetiredNativeRun, NATIVE_RUN_RETIRED_CODE, NATIVE_RUN_RETIRED_MESSAGE } from '@/shared/agents/native-run-retirement'
import { ConvexHarnessRepository } from '@/server/harness/ConvexHarnessRepository'

type Repositories = ReturnType<typeof getOverlayServerContext>['appData']['repositories']
type InputRouteDependencies = {
  conversations: Pick<Repositories['conversations'], 'getConversationById' | 'getLatestAgentRun'>
  collaboration?: Pick<Repositories['conversationCollaboration'], 'getAccessibleConversation'>
  resume: (token: string, reply: { text: string }) => Promise<unknown>
  submitWaitReply?: ConvexHarnessRepository['submitWaitReply']
}

const inactive = () => NextResponse.json({ error: 'This input request is no longer active.' }, { status: 409 })

function matchesInputWait(
  run: AgentRun | null,
  input: { agentRunId: string; conversationId: string; token: string },
  actorUserId: string,
  isRoom: boolean,
): run is AgentRun {
  if (!run || run.id !== input.agentRunId || run.conversationId !== input.conversationId
    || run.userId !== actorUserId || (run.mode === 'room') !== isRoom) return false
  return run.status === 'waiting_for_input' && run.inputRequest?.token === input.token
}

async function getAuthorizedInputConversation(
  conversations: InputRouteDependencies['conversations'],
  collaboration: InputRouteDependencies['collaboration'],
  input: { conversationId: ReturnType<typeof asConversationId>; actorUserId: string; workspaceId: string },
) {
  let conversation = await conversations.getConversationById({
    conversationId: input.conversationId, userId: input.actorUserId, workspaceId: input.workspaceId,
  })
  if (!conversation || (conversation.conversationType ?? 'personal') !== 'personal') {
    conversation = await collaboration?.getAccessibleConversation({
      actorUserId: input.actorUserId, conversationId: input.conversationId, workspaceId: input.workspaceId,
    }) ?? null
  }
  const isRoom = conversation && (conversation.conversationType ?? 'personal') !== 'personal'
  if (!conversation || (!isRoom && conversation.userId !== input.actorUserId)
    || (conversation.workspaceId !== undefined && conversation.workspaceId !== input.workspaceId)) return null
  return { conversation, isRoom: Boolean(isRoom) }
}

async function submitAuthorizedInputReply(input: {
  run: AgentRun
  actorUserId: string
  workspaceId: string
  token: string
  text: string
  submit?: ConvexHarnessRepository['submitWaitReply']
  resume: InputRouteDependencies['resume']
}) {
  if (input.run.harnessRunId && input.submit && await input.submit({
    actorUserId: input.actorUserId, workspaceId: input.workspaceId, deliveryAgentRunId: input.run.id,
    token: input.token, reply: { text: input.text },
  })) return
  await input.resume(input.token, { text: input.text })
}

export async function POST(request: NextRequest, context: AppApiRouteContext, dependencies?: InputRouteDependencies) {
  try {
    const body = await readValidatedJson(request, context, AgentRunInputRequest)
    if (!body.ok) return body.response
    const repositories = dependencies ? null : getOverlayServerContext().appData.repositories
    const conversations = dependencies?.conversations ?? repositories!.conversations
    const collaboration = dependencies?.collaboration ?? repositories?.conversationCollaboration
    const actorUserId = getAuthorizedResourceUserId(context)
    const conversationId = asConversationId(body.data.conversationId)
    const authorized = await getAuthorizedInputConversation(conversations, collaboration, {
      conversationId, actorUserId, workspaceId: context.workspace.workspace.id,
    })
    if (!authorized) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    const { isRoom } = authorized
    const run = await conversations.getLatestAgentRun({ conversationId, userId: actorUserId, agentRunId: body.data.agentRunId })
    if (!matchesInputWait(run, body.data, actorUserId, Boolean(isRoom))) return inactive()
    if (isRetiredNativeRun(run)) {
      return NextResponse.json({ error: NATIVE_RUN_RETIRED_MESSAGE, code: NATIVE_RUN_RETIRED_CODE }, { status: 410 })
    }
    if (run.runner !== 'workflow' || !run.workflowRunId) return inactive()
    const submit = dependencies ? dependencies.submitWaitReply
      : (input: Parameters<ConvexHarnessRepository['submitWaitReply']>[0]) => new ConvexHarnessRepository().submitWaitReply(input)
    // This is input to an existing work artifact, not a new turn. The hook
    // retains the full reply; the harness records bounded user-input evidence.
    await submitAuthorizedInputReply({
      run, actorUserId, workspaceId: context.workspace.workspace.id, token: body.data.token,
      text: body.data.text, submit, resume: dependencies?.resume ?? resumeHook,
    })
    return NextResponse.json({ success: true })
  } catch (error) {
    if (HookNotFoundError.is(error)) return inactive()
    logger.error('[conversations/run/input POST]', error)
    return NextResponse.json({ error: 'Could not submit input.' }, { status: 500 })
  }
}
