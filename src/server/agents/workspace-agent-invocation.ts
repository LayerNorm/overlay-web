import 'server-only'

import { streamText } from 'ai'
import { isStepCount, type ToolApprovalConfiguration } from '@/server/ai/sdk'
import { getLanguageModel } from '@/server/ai/model-runtime'
import { getOverlayServerContext } from '@/server/bootstrap'
import { logger } from '@/server/observability/logger'
import { hashOperationalIdentifier } from '@/server/security/operational-key-hash'
import {
  ActConversationServiceError,
  ActEntitlementService,
} from '@/server/conversations/ActEntitlementService'
import type { ConversationCollaborationRepository } from '@/server/conversations/ConversationCollaborationRepository'
import { FREE_TIER_AUTO_MODEL_ID, isFreeTierChatModelId } from '@/shared/ai/gateway/model-types'
import { buildWorkspaceAgentTooling } from './agent-tooling'
import { buildAgentTurnContext } from './agent-turn-context'
import { resolveMentionFirstInvocations } from './mention-policy'

/**
 * Step budgets.
 *
 * A one-to-one DM with an agent is the agent's own workspace: a long tool loop
 * there is expected, the same way it is in personal chat. A channel is shared,
 * so an agent that grinds for twenty steps in front of six people is a worse
 * experience than one that answers or asks. The channel cap lifts once agent
 * runs become durable and can show live progress — see INTERNAL_TODOs.md,
 * "Durable agent runs".
 */
const MAX_TOOL_STEPS_AGENT_DM = 20
const MAX_TOOL_STEPS_AGENT_CHANNEL = 8

const MAX_OUTPUT_TOKENS_AGENT = 4_000

/**
 * A tool loop needs longer than a single completion. This is still bounded by
 * the request that hosts it; a run that genuinely needs hours needs Phase 3.
 */
const AGENT_TURN_TIMEOUT_MS = 300_000

/** Memory tools; their presence in an agent's allow-list enables memory. */
const AGENT_MEMORY_TOOL_IDS = new Set([
  'search_memory',
  'save_memory',
  'save_memory_batch',
  'update_memory',
  'delete_memory',
])

export type WorkspaceAgentDelta = {
  agentPrincipalId: string
  agentName: string
  delta: string
}

export const WORKSPACE_AGENT_INVOCATION_REASON_CODES = [
  'room_access_denied',
  'not_a_collaboration_room',
  'no_agent_participant',
  'not_entitled',
  'usage_limited',
  'model_failed',
  'empty_response',
] as const

export type WorkspaceAgentInvocationReasonCode =
  typeof WORKSPACE_AGENT_INVOCATION_REASON_CODES[number]

const USER_SAFE_MESSAGES: Record<WorkspaceAgentInvocationReasonCode, string> = {
  room_access_denied: 'You do not have access to this conversation.',
  not_a_collaboration_room: 'Agents can only be mentioned in collaboration rooms.',
  no_agent_participant: 'No available agent participant could be resolved.',
  not_entitled: 'This agent is not available on your current plan.',
  usage_limited: 'Agent usage is temporarily limited. Try again later.',
  model_failed: 'The agent could not generate a reply. Try again.',
  empty_response: 'The agent returned an empty response. Try again.',
}

export class WorkspaceAgentInvocationError extends Error {
  constructor(
    readonly reasonCode: WorkspaceAgentInvocationReasonCode,
    message = USER_SAFE_MESSAGES[reasonCode],
  ) {
    super(message)
    this.name = 'WorkspaceAgentInvocationError'
  }
}

/**
 * The models an agent turn may attempt, in order.
 *
 * An agent is configured with one model, but the workspace paying for the turn
 * may not be entitled to it — a paid model on a free workspace, or a paid
 * workspace that has run out of budget. Falling back to the free router keeps
 * the agent answering instead of failing the turn outright.
 */
export function agentModelAttempts(modelId: string): string[] {
  return isFreeTierChatModelId(modelId) ? [modelId] : [modelId, FREE_TIER_AUTO_MODEL_ID]
}

async function loadAccessibleConversation(args: {
  actorUserId: string
  conversationId: string
  workspaceId: string
  collaboration: ConversationCollaborationRepository
  messageId: string
}): Promise<NonNullable<
  Awaited<ReturnType<ConversationCollaborationRepository['getAccessibleConversation']>>
>> {
  try {
    const conversation = await args.collaboration.getAccessibleConversation({
      actorUserId: args.actorUserId,
      conversationId: args.conversationId,
      workspaceId: args.workspaceId,
    })
    if (conversation) return conversation
    logger.warn('[workspace-agent] room access denied', {
      conversationId: args.conversationId,
      reason: 'room_access_denied',
      workspaceId: args.workspaceId,
    })
  } catch (error) {
    logger.error('[workspace-agent] room access denied', {
      conversationId: args.conversationId,
      error,
      messageId: args.messageId,
      reason: 'room_access_denied',
      workspaceId: args.workspaceId,
    })
  }
  throw new WorkspaceAgentInvocationError('room_access_denied')
}

export async function invokeWorkspaceAgentsForHumanMessage(args: {
  accessToken?: string
  actorUserId: string
  conversationId: string
  messageId: string
  mentionedPrincipalIds?: string[]
  threadRootMessageId?: string
  workspaceId: string
  /**
   * Called for every token as the agent writes. The reply is persisted the same
   * way with or without a listener; streaming only decides whether the caller
   * watches it arrive.
   */
  onDelta?: (event: WorkspaceAgentDelta) => void
  /** Aborts generation when the watching client disconnects. */
  signal?: AbortSignal
}): Promise<void> {
  const server = getOverlayServerContext()
  const collaboration = server.appData.repositories.conversationCollaboration
  const conversation = await loadAccessibleConversation({
    actorUserId: args.actorUserId,
    collaboration,
    conversationId: args.conversationId,
    messageId: args.messageId,
    workspaceId: args.workspaceId,
  })
  const [participants, history, directory] = await Promise.all([
    collaboration.listParticipants({
      actorUserId: args.actorUserId, conversationId: args.conversationId, workspaceId: args.workspaceId,
    }),
    collaboration.listMessages({
      actorUserId: args.actorUserId,
      conversationId: args.conversationId,
      limit: 100,
      workspaceId: args.workspaceId,
    }),
    server.workspaceAgentService.list({ actorUserId: args.actorUserId, workspaceId: args.workspaceId }),
  ])
  const conversationType = conversation.conversationType ?? 'personal'
  if (conversationType === 'personal') {
    logger.warn('[workspace-agent] room is not a collaboration room', {
      conversationId: args.conversationId,
      reason: 'not_a_collaboration_room',
      workspaceId: args.workspaceId,
    })
    throw new WorkspaceAgentInvocationError('not_a_collaboration_room')
  }
  const threadRoot = args.threadRootMessageId
    ? history.find((message) => message._id === args.threadRootMessageId)
    : undefined
  const resolvedPrincipalIds = resolveMentionFirstInvocations({
    authorKind: 'human',
    conversationType,
    participants: participants.map((participant) => ({
      principalId: participant.principalId,
      principalType: participant.principalType,
    })),
    mentionedPrincipalIds: args.mentionedPrincipalIds,
    repliedToAgentPrincipalId: threadRoot?.authorKind === 'agent'
      ? threadRoot.authorPrincipalId
      : undefined,
  })
  const principalIds = resolvedPrincipalIds
  if (principalIds.length === 0) {
    logger.warn('[workspace-agent] no agent participant resolved', {
      conversationId: args.conversationId,
      reason: 'no_agent_participant',
      workspaceId: args.workspaceId,
    })
    throw new WorkspaceAgentInvocationError('no_agent_participant')
  }
  // Cap the number of agents that can be invoked per message to prevent
  // cost amplification from mass-mentioning agents. Each agent gets its own
  // budget reservation, so without a cap a user could mention many agents
  // and consume significant tokens in a single message.
  const MAX_AGENTS_PER_MESSAGE = 5
  if (principalIds.length > MAX_AGENTS_PER_MESSAGE) {
    logger.warn('[workspace-agent] too many agents mentioned, capping', {
      conversationId: args.conversationId,
      count: principalIds.length,
      limit: MAX_AGENTS_PER_MESSAGE,
      workspaceId: args.workspaceId,
    })
  }
  const cappedPrincipalIds = principalIds.slice(0, MAX_AGENTS_PER_MESSAGE)
  const agentsByPrincipal = new Map(directory.agents.map((agent) => [agent.principalId, agent]))
  const triggeringMessage = history.find((message) => message._id === args.messageId)
  const latestUserText = triggeringMessage?.content
    ?? history.filter((message) => !message.deletedAt).at(-1)?.content
    ?? ''
  const maxToolSteps = conversationType === 'dm'
    ? MAX_TOOL_STEPS_AGENT_DM
    : MAX_TOOL_STEPS_AGENT_CHANNEL
  let completedResponses = 0
  let alreadyCompletedResponses = 0
  let lastFailureReason: WorkspaceAgentInvocationReasonCode | undefined
  for (const principalId of cappedPrincipalIds) {
    const agent = agentsByPrincipal.get(principalId)
    if (!agent || agent.archivedAt) {
      lastFailureReason = 'no_agent_participant'
      logger.warn('[workspace-agent] mentioned agent is unavailable', {
        conversationId: args.conversationId,
        principalId,
        reason: 'no_agent_participant',
        workspaceId: args.workspaceId,
      })
      continue
    }
    const invocationNonce = `agent:${args.messageId}:${agent.id}`
    if (history.some((message) => message.clientNonce === invocationNonce)) {
      alreadyCompletedResponses += 1
      continue
    }
    let reservationId: string | null = null
    let failureReason: WorkspaceAgentInvocationReasonCode = 'model_failed'
    try {
      const requestFingerprint = hashOperationalIdentifier(
        'workspace-agent-invocation',
        invocationNonce,
      )
      const programmaticSubjectId = `agent:${agent.id}`
      const entitlementService = new ActEntitlementService({
        repository: server.appData.repositories.conversations,
        usagePolicy: server.chatUsagePolicy,
      })
      // The agent's configured model may be out of reach for whoever is paying.
      // Try it, then fall back rather than failing the turn.
      const attempts = agentModelAttempts(agent.modelId)
      let gate: Awaited<ReturnType<ActEntitlementService['gateModelAccess']>> | undefined
      let effectiveModelId = agent.modelId
      let gateError: unknown
      for (const attemptModelId of attempts) {
        try {
          gate = await entitlementService.gateModelAccess({
            effectiveModelId: attemptModelId,
            programmaticSubjectId,
            userId: args.actorUserId,
            workspaceId: args.workspaceId,
          })
          effectiveModelId = attemptModelId
          gateError = undefined
          break
        } catch (error) {
          gateError = error
          logger.warn('[workspace-agent] model not available, trying fallback', {
            agentId: agent.id,
            attemptModelId,
            conversationId: args.conversationId,
          })
        }
      }
      if (!gate) throw gateError ?? new Error('No agent model attempt succeeded')
      const { paid, runtimeEntitlements } = gate

      const estimatedInputTokens = Math.ceil(JSON.stringify(history.slice(-24)).length / 4) + 1_000
      const reservation = await server.chatUsagePolicy.reserveForAttempt({
        entitlements: runtimeEntitlements,
        estimatedInputTokens,
        // The invocation nonce is already the idempotent trigger key for this
        // (message, agent) pair, so a duplicate mention or a reconnect reserves
        // budget once rather than charging twice.
        idempotencyKey: invocationNonce,
        maxOutputTokens: MAX_OUTPUT_TOKENS_AGENT,
        modelId: effectiveModelId,
        operationId: 'workspace.agent.invoke',
        paid,
        requestFingerprint,
        programmaticSubjectId,
        userId: args.actorUserId,
        workspaceId: args.workspaceId,
      })
      if (!reservation.ok) {
        failureReason = 'usage_limited'
        lastFailureReason = failureReason
        logger.warn('[workspace-agent] invocation skipped by usage policy', {
          agentId: agent.id,
          conversationId: args.conversationId,
          reason: failureReason,
          statusCode: reservation.failure.statusCode,
        })
        continue
      }
      reservationId = reservation.reservationId
      const model = await getLanguageModel(effectiveModelId, args.accessToken)

      const isDefaultMaster = Boolean(agent.isDefault || agent.name.toLowerCase() === 'overlay')
      const memoryEnabled = isDefaultMaster
        || agent.allowedToolIds.some((id) => AGENT_MEMORY_TOOL_IDS.has(id))

      // Context and tooling are independent and both hit the network.
      const [turnContext, tooling] = await Promise.all([
        buildAgentTurnContext({
          accessToken: args.accessToken,
          actorUserId: args.actorUserId,
          agentName: agent.name,
          agentPrincipalId: agent.principalId,
          billingProgrammaticSubjectId: programmaticSubjectId,
          conversationTitle: conversation.title,
          conversationType,
          history,
          idempotencyKey: `${invocationNonce}:context`,
          latestUserText,
          memoryEnabled,
          participants: participants.map((participant) => ({
            displayName: participant.displayName,
            principalId: participant.principalId,
            principalType: participant.principalType,
          })),
          projectId: conversation.projectId,
          requestFingerprint,
          workspaceId: args.workspaceId,
        }),
        buildWorkspaceAgentTooling({
          accessToken: args.accessToken,
          actorUserId: args.actorUserId,
          agentPrincipalId: agent.principalId,
          conversationId: args.conversationId,
          effectiveModelId,
          entitlements: runtimeEntitlements,
          grant: {
            agentId: agent.id,
            allowedToolIds: agent.allowedToolIds,
            isDefaultMaster,
          },
          idempotencyKey: invocationNonce,
          latestUserText,
          memoryEnabled,
          paid,
          requestFingerprint,
          turnId: `agent_${args.messageId}_${agent.id}`,
          workspaceId: args.workspaceId,
        }),
      ])

      const hasTools = Object.keys(tooling.tools).length > 0
      const result = streamText({
        model,
        maxOutputTokens: MAX_OUTPUT_TOKENS_AGENT,
        temperature: 0.4,
        ...(hasTools
          ? {
              tools: tooling.tools,
              stopWhen: isStepCount(maxToolSteps),
              // Approval-gated MCP tools stay gated for agents too. Nothing in a
              // room can grant that approval yet, so such a call stalls rather
              // than running unapproved — the safe failure of the two. The room
              // approval card lands with durable runs (INTERNAL_TODOs.md).
              ...(tooling.toolApproval
                ? {
                    toolApproval: tooling.toolApproval as unknown as ToolApprovalConfiguration<
                      typeof tooling.tools,
                      unknown
                    >,
                  }
                : {}),
            }
          : {}),
        abortSignal: args.signal
          ? AbortSignal.any([args.signal, AbortSignal.timeout(AGENT_TURN_TIMEOUT_MS)])
          : AbortSignal.timeout(AGENT_TURN_TIMEOUT_MS),
        system: buildAgentSystemPrompt({
          agentName: agent.name,
          contextBlock: turnContext.contextBlock,
          exposedToolIds: tooling.exposedToolIds,
          hasTools,
          instructions: agent.instructions,
          isDefaultMaster,
        }),
        messages: turnContext.messages,
      })
      let streamed = ''
      let streamFailed = false
      try {
        for await (const delta of result.textStream) {
          streamed += delta
          args.onDelta?.({ agentPrincipalId: agent.principalId, agentName: agent.name, delta })
        }
      } catch (streamError) {
        streamFailed = true
        failureReason = 'model_failed'
        lastFailureReason = failureReason
        // A disconnect or timeout still leaves partial text worth keeping; an
        // empty result falls through to the release path below.
        logger.warn('[workspace-agent] stream ended early', {
          agentId: agent.id,
          error: streamError instanceof Error ? streamError.message : String(streamError),
          reason: failureReason,
        })
      }
      const usage = await Promise.resolve(result.usage).catch((_error) => undefined)
      const content = streamed.trim()
      if (!content) {
        failureReason = streamFailed ? 'model_failed' : 'empty_response'
        lastFailureReason = failureReason
        await server.chatUsagePolicy.releaseReservation({
          reason: 'workspace_agent_empty_response',
          reservationId,
          userId: args.actorUserId,
        })
        logger.warn('[workspace-agent] invocation produced no response', {
          agentId: agent.id,
          conversationId: args.conversationId,
          reason: failureReason,
        })
        reservationId = null
        continue
      }
      const responseId = await collaboration.addAgentMessage({
        actorUserId: args.actorUserId,
        conversationId: args.conversationId,
        workspaceId: args.workspaceId,
        authorPrincipalId: agent.principalId,
        clientNonce: invocationNonce,
        threadRootMessageId: args.threadRootMessageId,
        turnId: `agent_${args.messageId}_${agent.id}`,
        content,
        modelId: effectiveModelId,
        tokens: usageTokens(usage),
      })
      if (!responseId) {
        failureReason = 'model_failed'
        lastFailureReason = failureReason
        logger.warn('[workspace-agent] response was not persisted', {
          agentId: agent.id,
          reason: failureReason,
        })
      } else completedResponses += 1
      const tokens = usageTokens(usage) ?? { input: 0, output: 0 }
      const recorded = await server.chatUsagePolicy.recordFinishedUsage({
        forceFreeTierLimits: !paid,
        inputTokens: tokens.input,
        modelId: effectiveModelId,
        outputTokens: tokens.output,
        reservationId,
        userId: args.actorUserId,
      })
      reservationId = recorded.reservationId
    } catch (error) {
      const isEntitlementError = error instanceof ActConversationServiceError
      failureReason = isEntitlementError ? 'not_entitled' : failureReason
      lastFailureReason = failureReason
      await server.chatUsagePolicy.releaseReservation({
        reason: 'workspace_agent_invocation_failed',
        reservationId,
        userId: args.actorUserId,
      }).catch((_error) => undefined)
      logger.error('[workspace-agent] invocation failed', {
        agentId: agent.id,
        conversationId: args.conversationId,
        error,
        messageId: args.messageId,
        reason: failureReason,
        workspaceId: args.workspaceId,
      })
    }
  }
  if (completedResponses === 0 && alreadyCompletedResponses === 0) {
    throw new WorkspaceAgentInvocationError(lastFailureReason ?? 'model_failed')
  }
}

/**
 * The agent's standing instructions plus everything loaded for this turn.
 *
 * Kept separate from the transcript: the room history is `messages`, so the
 * model can tell what it said from what it was told.
 */
export function buildAgentSystemPrompt(args: {
  agentName: string
  contextBlock: string
  exposedToolIds: readonly string[]
  hasTools: boolean
  instructions: string
  isDefaultMaster: boolean
}): string {
  // Only promise recall when recall is actually on the table. Telling an agent
  // to search a memory it cannot reach is how it ends up narrating tool calls
  // that never happened.
  const canRecall = args.exposedToolIds.includes('search_memory')
  return [
    `You are ${args.agentName}, a named AI teammate in an Overlay workspace.`,
    args.instructions,
    args.isDefaultMaster
      ? 'You are the default Overlay master workspace agent with full access to workspace context, files, notes, automations, skills, and tools.'
      : 'Respond as this agent, not as a generic assistant.',
    args.hasTools
      ? [
          'Use your available tools when they genuinely help, and prefer checking over guessing.',
          canRecall
            ? 'Before answering a question about the user, the workspace, or past work, call search_memory rather than assuming you know nothing.'
            : '',
          'Never claim to have used a tool or changed a resource unless the tool call actually ran.',
        ].filter(Boolean).join(' ')
      : 'You have no tools or resource access in this turn. Never claim that you used or changed a resource.',
    'Be concise, useful, and explicit when context is insufficient.',
    args.contextBlock,
  ].filter((section) => section && section.trim()).join('\n')
}

function usageTokens(usage: { inputTokens?: number; outputTokens?: number } | undefined) {
  if (!usage) return undefined
  return { input: usage.inputTokens ?? 0, output: usage.outputTokens ?? 0 }
}
