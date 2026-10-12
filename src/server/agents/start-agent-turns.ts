import 'server-only'

import { start } from 'workflow/api'
import { getOverlayServerContext } from '@/server/bootstrap'
import { logger } from '@/server/observability/logger'
import { workspaceAgentTurnWorkflow } from '@/server/workflows/workspace-agent-turn'
import { agentStartFailureMessage } from '@/server/app-api/v1/conversations/message/agent-start-failure'
import {
  resolveWorkspaceAgentInvocations,
  startRemoteWorkspaceAgentTurn,
  WorkspaceAgentInvocationError,
  type WorkspaceAgentInvocation,
} from '@/server/agents/workspace-agent-invocation'

/**
 * Opens a durable run per agent that owes a reply, and starts the workflow that
 * writes it.
 *
 * This is the only thing that invokes a room agent. Triggering server-side is
 * what makes a turn asynchronous: the sender's request returns as soon as the
 * runs exist, and the turns continue whether or not anyone is still watching.
 * Failures here are logged rather than raised — the human message is already
 * saved, and failing the send because an agent could not be started would be
 * the worse outcome.
 */
export async function startWorkspaceAgentTurns(args: {
  actorUserId: string
  conversationId: string
  messageId: string
  mentionedPrincipalIds: string[]
  initiatorPrincipalId: string
  prompt: string
  memoryEnabled: boolean
  turnId: string
  threadRootMessageId?: string
  workspaceId: string
  /** False when the message was written by an agent, not a person, so there is no person's message to learn from. */
  extractHumanMemory?: boolean
}): Promise<WorkspaceAgentInvocation[]> {
  const collaboration = getOverlayServerContext().appData.repositories.conversationCollaboration
  const invocations = await resolveWorkspaceAgentInvocations(args)
  if (args.memoryEnabled && args.extractHumanMemory !== false && invocations.length > 0) {
    await collaboration.enqueueMemoryExtraction({
      actorUserId: args.actorUserId,
      conversationId: args.conversationId,
      memoryOwnerId: args.actorUserId,
      messageId: args.messageId,
      targetActor: 'human',
      turnId: args.turnId,
      workspaceId: args.workspaceId,
    }).catch((error) => {
      logger.warn('[conversations/message POST] Failed to enqueue human memory extraction', { error })
    })
  }
  await Promise.all(invocations.map(async (invocation) => {
    try {
      if (invocation.remoteTarget?.protocolAdapter === 'harness') {
        // Managed harness runtimes were removed; the room gets the failure
        // message rather than a silent switch to a different runtime.
        throw new WorkspaceAgentInvocationError('not_entitled', 'This agent’s hosted runtime is no longer available. Recreate it as an Overlay agent or connect your own machine.')
      }
      if (invocation.remoteTarget) {
        await startRemoteWorkspaceAgentTurn({
          actorUserId: args.actorUserId,
          conversationId: args.conversationId,
          initiatorPrincipalId: args.initiatorPrincipalId,
          invocation: { ...invocation, remoteTarget: invocation.remoteTarget },
          messageId: args.messageId,
          memoryEnabled: args.memoryEnabled,
          prompt: args.prompt,
          ...(args.threadRootMessageId ? { threadRootMessageId: args.threadRootMessageId } : {}),
          workspaceId: args.workspaceId,
        })
        return
      }
      const turn = await collaboration.startAgentTurn({
        actorUserId: args.actorUserId,
        agentId: invocation.agentId,
        authorPrincipalId: invocation.agentPrincipalId,
        clientNonce: invocation.invocationNonce,
        conversationId: args.conversationId,
        modelId: invocation.modelId,
        threadRootMessageId: args.threadRootMessageId,
        turnId: invocation.turnId,
        userMessageId: args.messageId,
        workspaceId: args.workspaceId,
      })
      // A turn already exists for this (message, agent): a duplicate trigger,
      // or a retried send. Starting a second workflow against the same reply
      // row would bill the turn twice.
      if (turn.resumed) return
      await start(workspaceAgentTurnWorkflow, [{
        actorUserId: args.actorUserId,
        agentId: invocation.agentId,
        conversationId: args.conversationId,
        messageId: args.messageId,
        memoryEnabled: args.memoryEnabled,
        runId: turn.runId,
        ...(args.threadRootMessageId ? { threadRootMessageId: args.threadRootMessageId } : {}),
        turnMessageId: turn.messageId,
        workspaceId: args.workspaceId,
      }])
    } catch (error) {
      logger.error('[conversations/message POST] Failed to start an agent turn', {
        agentId: invocation.agentId,
        conversationId: args.conversationId,
        error,
        messageId: args.messageId,
      })
      const failureMessage = agentStartFailureMessage(invocation.agentName, error)
      await collaboration.startAgentMessage({
        actorUserId: args.actorUserId,
        authorPrincipalId: invocation.agentPrincipalId,
        clientNonce: invocation.invocationNonce,
        conversationId: args.conversationId,
        modelId: invocation.modelId,
        threadRootMessageId: args.threadRootMessageId,
        turnId: invocation.turnId,
        workspaceId: args.workspaceId,
      }).then(async (failureMessageId) => {
        await collaboration.failAgentMessage({
          actorUserId: args.actorUserId,
          content: failureMessage,
          conversationId: args.conversationId,
          messageId: failureMessageId,
          workspaceId: args.workspaceId,
        })
      }).catch((persistenceError) => {
        logger.error('[conversations/message POST] Failed to persist agent-start failure', {
          agentId: invocation.agentId,
          conversationId: args.conversationId,
          error: persistenceError,
          messageId: args.messageId,
        })
      })
    }
  }))
  return invocations
}
