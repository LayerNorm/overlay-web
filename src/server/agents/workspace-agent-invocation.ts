import 'server-only'

import { generateText } from 'ai'
import type { Id } from '../../../convex/_generated/dataModel'
import { getLanguageModel } from '@/server/ai/model-runtime'
import { getOverlayServerContext } from '@/server/bootstrap'
import { logger } from '@/server/observability/logger'
import { ActEntitlementService } from '@/server/conversations/ActEntitlementService'
import { resolveMentionFirstInvocations } from './mention-policy'

export async function invokeWorkspaceAgentsForHumanMessage(args: {
  accessToken?: string
  actorUserId: string
  conversationId: string
  messageId: string
  mentionedPrincipalIds?: string[]
  threadRootMessageId?: string
  workspaceId: string
}): Promise<void> {
  const server = getOverlayServerContext()
  const conversationId = args.conversationId as Id<'conversations'>
  const [conversation, participants, history, directory] = await Promise.all([
    server.appData.repositories.conversations.getConversationById({
      conversationId, userId: args.actorUserId, workspaceId: args.workspaceId,
    }),
    server.appData.repositories.conversationCollaboration.listParticipants({
      actorUserId: args.actorUserId, conversationId: args.conversationId, workspaceId: args.workspaceId,
    }),
    server.appData.repositories.conversations.getConversationMessages({
      conversationId, userId: args.actorUserId, workspaceId: args.workspaceId,
    }),
    server.workspaceAgentService.list({ actorUserId: args.actorUserId, workspaceId: args.workspaceId }),
  ])
  if (!conversation || conversation.conversationType === 'personal') return
  const threadRoot = args.threadRootMessageId
    ? history.find((message) => message._id === args.threadRootMessageId)
    : undefined
  const principalIds = resolveMentionFirstInvocations({
    authorKind: 'human',
    conversationType: conversation.conversationType,
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
  for (const principalId of principalIds) {
    const agent = agentsByPrincipal.get(principalId)
    if (!agent || agent.archivedAt) continue
    const invocationNonce = `agent:${args.messageId}:${agent.id}`
    if (history.some((message) => message.clientNonce === invocationNonce)) continue
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
        maxOutputTokens: 2_000,
        modelId: agent.modelId,
        paid,
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
      const result = await generateText({
        model,
        maxOutputTokens: 2_000,
        temperature: 0.4,
        abortSignal: AbortSignal.timeout(120_000),
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
      const content = result.text.trim()
      if (!content) {
        await server.chatUsagePolicy.releaseReservation({
          reason: 'workspace_agent_empty_response',
          reservationId,
          userId: args.actorUserId,
        })
        reservationId = null
        continue
      }
      const responseId = await server.appData.repositories.conversations.addMessage({
        conversationId,
        userId: args.actorUserId,
        workspaceId: args.workspaceId,
        authorKind: 'agent',
        authorPrincipalId: agent.principalId,
        clientNonce: invocationNonce,
        threadRootMessageId: args.threadRootMessageId,
        turnId: `agent_${args.messageId}_${agent.id}`,
        role: 'assistant',
        mode: 'act',
        content,
        contentType: 'text',
        modelId: agent.modelId,
        tokens: usageTokens(result.usage),
        skipMemoryExtraction: true,
      })
      if (!responseId) logger.warn('[workspace-agent] response was not persisted', { agentId: agent.id })
      const tokens = usageTokens(result.usage) ?? { input: 0, output: 0 }
      const usage = await server.chatUsagePolicy.recordFinishedUsage({
        forceFreeTierLimits: !paid,
        inputTokens: tokens.input,
        modelId: agent.modelId,
        outputTokens: tokens.output,
        reservationId,
        userId: args.actorUserId,
      })
      reservationId = usage.reservationId
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
}

function usageTokens(usage: { inputTokens?: number; outputTokens?: number } | undefined) {
  if (!usage) return undefined
  return { input: usage.inputTokens ?? 0, output: usage.outputTokens ?? 0 }
}
