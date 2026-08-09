import 'server-only'

import { streamText } from 'ai'
import { getLanguageModel } from '@/server/ai/model-runtime'
import { getOverlayServerContext } from '@/server/bootstrap'
import { logger } from '@/server/observability/logger'
import { hashOperationalIdentifier } from '@/server/security/operational-key-hash'
import { ActEntitlementService } from '@/server/conversations/ActEntitlementService'
import { resolveMentionFirstInvocations } from './mention-policy'

export type WorkspaceAgentDelta = {
  agentPrincipalId: string
  agentName: string
  delta: string
}

export class WorkspaceAgentInvocationError extends Error {
  constructor(message = 'The mentioned agent could not respond') {
    super(message)
    this.name = 'WorkspaceAgentInvocationError'
  }
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
  const [conversation, participants, history, directory] = await Promise.all([
    collaboration.getAccessibleConversation({
      actorUserId: args.actorUserId,
      conversationId: args.conversationId,
      workspaceId: args.workspaceId,
    }),
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
  if (!conversation || (conversation.conversationType ?? 'personal') === 'personal') return
  const threadRoot = args.threadRootMessageId
    ? history.find((message) => message._id === args.threadRootMessageId)
    : undefined
  const principalIds = resolveMentionFirstInvocations({
    authorKind: 'human',
    conversationType: conversation.conversationType ?? 'personal',
    participants: participants.map((participant) => ({
      principalId: participant.principalId,
      principalType: participant.principalType,
    })),
    mentionedPrincipalIds: args.mentionedPrincipalIds,
    repliedToAgentPrincipalId: threadRoot?.authorKind === 'agent'
      ? threadRoot.authorPrincipalId
      : undefined,
  })
  if (principalIds.length === 0) return
  const agentsByPrincipal = new Map(directory.agents.map((agent) => [agent.principalId, agent]))
  let completedResponses = 0
  let alreadyCompletedResponses = 0
  for (const principalId of principalIds) {
    const agent = agentsByPrincipal.get(principalId)
    if (!agent || agent.archivedAt) continue
    const invocationNonce = `agent:${args.messageId}:${agent.id}`
    if (history.some((message) => message.clientNonce === invocationNonce)) {
      alreadyCompletedResponses += 1
      continue
    }
    let reservationId: string | null = null
    try {
      const entitlementService = new ActEntitlementService({
        repository: server.appData.repositories.conversations,
        usagePolicy: server.chatUsagePolicy,
      })
      const { paid, runtimeEntitlements } = await entitlementService.gateModelAccess({
        effectiveModelId: agent.modelId,
        userId: args.actorUserId,
      })
      const estimatedInputTokens = Math.ceil(JSON.stringify(history.slice(-24)).length / 4) + 1_000
      const reservation = await server.chatUsagePolicy.reserveForAttempt({
        entitlements: runtimeEntitlements,
        estimatedInputTokens,
        // The invocation nonce is already the idempotent trigger key for this
        // (message, agent) pair, so a duplicate mention or a reconnect reserves
        // budget once rather than charging twice.
        idempotencyKey: invocationNonce,
        maxOutputTokens: 2_000,
        modelId: agent.modelId,
        operationId: 'workspace.agent.invoke',
        paid,
        requestFingerprint: hashOperationalIdentifier(
          'workspace-agent-invocation',
          invocationNonce,
        ),
        userId: args.actorUserId,
      })
      if (!reservation.ok) {
        logger.warn('[workspace-agent] invocation skipped by usage policy', {
          agentId: agent.id,
          conversationId: args.conversationId,
          statusCode: reservation.failure.statusCode,
        })
        continue
      }
      reservationId = reservation.reservationId
      const model = await getLanguageModel(agent.modelId, args.accessToken)
      const transcript = history
        .filter((message) => !message.deletedAt)
        .slice(-24)
        .map((message) => {
          const participant = participants.find((item) => item.principalId === message.authorPrincipalId)
          const author = participant?.displayName ?? (message.authorKind === 'agent' ? 'Agent' : 'Human')
          return `${author}: ${message.content}`
        })
        .join('\n')
      const result = streamText({
        model,
        maxOutputTokens: 2_000,
        temperature: 0.4,
        abortSignal: args.signal
          ? AbortSignal.any([args.signal, AbortSignal.timeout(120_000)])
          : AbortSignal.timeout(120_000),
        prompt: [
          `You are ${agent.name}, a named AI teammate in an Overlay workspace.`,
          agent.instructions,
          'Respond as this agent, not as a generic assistant.',
          'You have no tools or resource access in this turn. Never claim that you used or changed a resource.',
          'Be concise, useful, and explicit when context is insufficient.',
          '',
          'Conversation:',
          transcript,
        ].join('\n'),
      })
      let streamed = ''
      try {
        for await (const delta of result.textStream) {
          streamed += delta
          args.onDelta?.({ agentPrincipalId: agent.principalId, agentName: agent.name, delta })
        }
      } catch (streamError) {
        // A disconnect or timeout still leaves partial text worth keeping; an
        // empty result falls through to the release path below.
        logger.warn('[workspace-agent] stream ended early', {
          agentId: agent.id,
          error: streamError instanceof Error ? streamError.message : String(streamError),
        })
      }
      const usage = await Promise.resolve(result.usage).catch((_error) => undefined)
      const content = streamed.trim()
      if (!content) {
        await server.chatUsagePolicy.releaseReservation({
          reason: 'workspace_agent_empty_response',
          reservationId,
          userId: args.actorUserId,
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
        modelId: agent.modelId,
        tokens: usageTokens(usage),
      })
      if (!responseId) logger.warn('[workspace-agent] response was not persisted', { agentId: agent.id })
      else completedResponses += 1
      const tokens = usageTokens(usage) ?? { input: 0, output: 0 }
      const recorded = await server.chatUsagePolicy.recordFinishedUsage({
        forceFreeTierLimits: !paid,
        inputTokens: tokens.input,
        modelId: agent.modelId,
        outputTokens: tokens.output,
        reservationId,
        userId: args.actorUserId,
      })
      reservationId = recorded.reservationId
    } catch (error) {
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
        workspaceId: args.workspaceId,
      })
    }
  }
  if (completedResponses === 0 && alreadyCompletedResponses === 0) {
    throw new WorkspaceAgentInvocationError()
  }
}

function usageTokens(usage: { inputTokens?: number; outputTokens?: number } | undefined) {
  if (!usage) return undefined
  return { input: usage.inputTokens ?? 0, output: usage.outputTokens ?? 0 }
}
