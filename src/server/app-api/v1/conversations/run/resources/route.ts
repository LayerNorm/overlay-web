import { NextRequest, NextResponse } from 'next/server'
import { resumeHook } from 'workflow/api'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import { getAuthorizedResourceUserId } from '@/server/app-api/bff-context'
import { readValidatedJson } from '@/server/app-api/validated-input'
import {
  asConversationId,
  type ConversationListRow,
} from '@/server/conversations/ActConversationRepository'
import { isTerminalAgentRunStatus } from '@/shared/agents/agent-run'
import type { AgentRun } from '@/shared/agents/agent-run'
import { AgentRunResourceRequest } from '@/shared/schemas/chat'
import type { ConvexHarnessRepository } from '@/server/harness/ConvexHarnessRepository'
import type { HarnessResourceGrantReceipt } from '@overlay/agent-runtime/harness-resource'
import { logger } from '@/server/observability/logger'

type ResourceRouteDependencies = {
  conversations: {
    getConversationById: (args: {
      conversationId: ReturnType<typeof asConversationId>
      userId: string
      workspaceId?: string
    }) => Promise<ConversationListRow | null>
    getLatestAgentRun: (args: {
      agentRunId?: string
      conversationId: ReturnType<typeof asConversationId>
      userId: string
    }) => Promise<AgentRun | null>
  }
  harness: Pick<ConvexHarnessRepository, 'grantResources'>
  resume?: (token: string, payload: { token: string }) => Promise<unknown>
}

function authorizedOwner(context: AppApiRouteContext, actorUserId: string): boolean {
  const access = context.workspace
  return context.auth.authType === 'session'
    && context.auth.userId === actorUserId
    && access.workspace.kind === 'personal'
    && access.workspace.status === 'active'
    && access.principal.type === 'human'
    && access.principal.userId === actorUserId
    && access.principal.workspaceId === access.workspace.id
    && access.membership.workspaceId === access.workspace.id
    && access.membership.principalId === access.principal.id
    && access.membership.status === 'active'
    && access.membership.role === 'owner'
}

function ownedPersonalConversation(
  conversation: ConversationListRow | null,
  actorUserId: string,
  workspaceId: string,
): boolean {
  return Boolean(conversation
    && (conversation.conversationType ?? 'personal') === 'personal'
    && !conversation.isAutomation
    && conversation.externalPlatform === undefined
    && conversation.externalChannelId === undefined
    && conversation.externalThreadId === undefined
    && conversation.surfaceBindingId === undefined
    && conversation.userId === actorUserId
    && conversation.workspaceId === workspaceId)
}

function activePersonalHarnessRun(
  run: AgentRun | null,
  agentRunId: string,
  conversationId: string,
  actorUserId: string,
): run is AgentRun & { harnessRunId: string; workflowRunId: string } {
  return Boolean(run && run.id === agentRunId && run.conversationId === conversationId
    && run.userId === actorUserId && run.runner === 'workflow' && run.executionEngine === 'overlay_harness'
    && (run.mode === 'chat' || run.mode === 'work') && run.harnessRunId && run.workflowRunId
    && !isTerminalAgentRunStatus(run.status))
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : ''
}

function hasWakeAcknowledgement(value: unknown): value is { runId: string } {
  return typeof value === 'object' && value !== null
    && 'runId' in value && typeof value.runId === 'string'
}

function responseForGrantError(error: unknown): NextResponse {
  const message = errorText(error)
  if (/STALE|CONFLICT|EXHAUSTED|unsupported|invalid|TERMINAL|must (?:increase the cap|cover current commitments)|grant scope must match|outside the safe range/i.test(message)) {
    return NextResponse.json({ error: 'The resource request changed; refresh the run and try again.' }, { status: 409 })
  }
  if (/HARNESS_RESOURCE_(?:NOT_AUTHORIZED|AUTHORITY_CHANGED|MEMBERSHIP_DENIED|PAYER_DENIED|SOURCE_DENIED|WORKSPACE_DENIED)|WORKSPACE_ACCESS_DENIED|HARNESS_ACCESS_DENIED|NOT_FOUND|ACCESS_DENIED|UNAUTHORIZED/i.test(message)) {
    return NextResponse.json({ error: 'This resource grant is not authorized.' }, { status: 403 })
  }
  return NextResponse.json({ error: 'Could not commit the resource grant.' }, { status: 500 })
}

export async function POST(
  request: NextRequest,
  context: AppApiRouteContext,
  dependencies?: ResourceRouteDependencies,
) {
  const actorUserId = getAuthorizedResourceUserId(context)
  if (!authorizedOwner(context, actorUserId)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
  const body = await readValidatedJson(request, context, AgentRunResourceRequest)
  if (!body.ok) return body.response
  try {
    const conversations = dependencies?.conversations
      ?? (await import('@/server/bootstrap')).getOverlayServerContext().appData.repositories.conversations
    const harness = dependencies?.harness
      ?? new (await import('@/server/harness/ConvexHarnessRepository')).ConvexHarnessRepository()
    const conversation = await conversations.getConversationById({
      conversationId: asConversationId(body.data.conversationId),
      userId: actorUserId,
      workspaceId: context.workspace.workspace.id,
    })
    if (!ownedPersonalConversation(conversation, actorUserId, context.workspace.workspace.id)) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
    const run = await conversations.getLatestAgentRun({
      conversationId: asConversationId(body.data.conversationId),
      agentRunId: body.data.agentRunId,
      userId: actorUserId,
    })
    if (!activePersonalHarnessRun(run, body.data.agentRunId, body.data.conversationId, actorUserId)) {
      return NextResponse.json({ error: 'The resource request is no longer active.' }, { status: 409 })
    }
    let receipt: HarnessResourceGrantReceipt
    try {
      receipt = await harness.grantResources({
        actorUserId,
        workspaceId: context.workspace.workspace.id,
        runId: run.harnessRunId,
        workflowRunId: run.workflowRunId,
        token: body.data.token,
        policyRevision: body.data.policyRevision,
        grant: body.data.grant,
      })
    } catch (error) {
      return responseForGrantError(error)
    }
    try {
      const acknowledgement = await (dependencies?.resume ?? resumeHook)(body.data.token, { token: body.data.token })
      if (!hasWakeAcknowledgement(acknowledgement)) {
        logger.warn('[conversations/run/resources POST] wake notification unavailable', {
          code: 'resource_wake_notification_unacknowledged',
        })
      }
    } catch (_error) {
      logger.warn('[conversations/run/resources POST] wake notification unavailable', {
        code: 'resource_wake_notification_failed',
      })
    }
    return NextResponse.json({ receipt })
  } catch (error) {
    return responseForGrantError(error)
  }
}
