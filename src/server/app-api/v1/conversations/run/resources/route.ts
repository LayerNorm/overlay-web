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

const resourceGrantConflictCodes = [
  'HARNESS_RESOURCE_STALE',
  'HARNESS_RESOURCE_TOKEN_CONFLICT',
  'HARNESS_RESOURCE_GRANT_CONFLICT',
] as const

const resourceGrantAuthorityCodes = [
  'HARNESS_RESOURCE_NOT_AUTHORIZED',
  'HARNESS_RESOURCE_AUTHORITY_CHANGED',
  'HARNESS_RESOURCE_MEMBERSHIP_DENIED',
  'HARNESS_RESOURCE_PAYER_DENIED',
  'HARNESS_RESOURCE_SOURCE_DENIED',
  'HARNESS_RESOURCE_WORKSPACE_DENIED',
  'HARNESS_RESOURCE_NOT_FOUND',
  'WORKSPACE_ACCESS_DENIED',
  'CONVERSATION_ACCESS_DENIED',
  'HARNESS_ACCESS_DENIED',
] as const

const resourceGrantConflictMessages = [
  'The grant scope must match the resource request reason.',
  'The model-spend grant must increase the cap without exceeding 100,000,000 micros.',
  'The model-spend grant must cover current commitments and the forecast.',
  'The time grant duration is unsupported.',
  'The resulting resource deadline is outside the safe range.',
] as const

function includesKnownCode(message: string, codes: readonly string[]): boolean {
  return codes.some(code => new RegExp(`(?:^|[^A-Z0-9_])${code}(?:$|[^A-Z0-9_])`).test(message))
}

function responseForGrantError(error: unknown): NextResponse {
  const message = errorText(error)
  if (includesKnownCode(message, resourceGrantConflictCodes)
    || resourceGrantConflictMessages.some(sentence => message.includes(sentence))) {
    return NextResponse.json({
      code: 'resource_request_changed',
      error: 'The resource request changed; refresh the run and try again.',
    }, { status: 409 })
  }
  if (includesKnownCode(message, resourceGrantAuthorityCodes)) {
    return NextResponse.json({
      code: 'resource_not_authorized',
      error: 'This resource grant is not authorized.',
    }, { status: 403 })
  }
  return NextResponse.json({
    code: 'resource_grant_unconfirmed',
    error: 'Could not confirm the resource grant. Refresh the run to check its authorization.',
  }, { status: 500 })
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
      return NextResponse.json({
        code: 'resource_request_changed',
        error: 'The resource request is no longer active.',
      }, { status: 409 })
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
