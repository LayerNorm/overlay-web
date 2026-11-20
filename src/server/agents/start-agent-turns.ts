import 'server-only'

import { getOverlayServerContext } from '@/server/bootstrap'
import { logger } from '@/server/observability/logger'
import { startNativeHarnessTurn } from '@/server/harness/native-turn-start'
import { agentStartFailureMessage, agentStartFailureReason } from '@/server/app-api/v1/conversations/message/agent-start-failure'
import { requireWorkspaceExecution } from '@/server/billing/WorkspaceExecutionPolicy'
import {
  resolveWorkspaceAgentInvocations,
  WorkspaceAgentInvocationError,
  type WorkspaceAgentInvocation,
} from '@/server/agents/workspace-agent-invocation'

type WorkspaceAgentTurnsArgs = {
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
  /** Assignment callers must know when a run could not be started. */
  strictErrors?: boolean
}

export type WorkspaceAgentTurnDispatcherDependencies = {
  resolveInvocations?: typeof resolveWorkspaceAgentInvocations
  requireExecution?: typeof requireWorkspaceExecution
  getCollaboration?: () => ReturnType<typeof getOverlayServerContext>['appData']['repositories']['conversationCollaboration']
  startNative?: typeof startNativeHarnessTurn
  /** Queues a message for outside agents (joined over MCP), which Overlay cannot start. */
  deliverToOutsideAgents?: (args: {
    actorUserId: string; workspaceId: string; conversationId: string; messageId: string; prompt: string
    threadRootMessageId?: string; targets: Array<{ agentId: string; turnId: string }>
  }) => Promise<Array<{ agentId: string; turnId: string; availability: 'online' | 'away' }>>
}

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
export async function startWorkspaceAgentTurns(
  args: WorkspaceAgentTurnsArgs,
  dependencies: WorkspaceAgentTurnDispatcherDependencies = {},
): Promise<WorkspaceAgentInvocation[]> {
  const collaboration = dependencies.getCollaboration?.()
    ?? getOverlayServerContext().appData.repositories.conversationCollaboration
  const resolved = await (dependencies.resolveInvocations ?? resolveWorkspaceAgentInvocations)(args)
  if (args.strictErrors && resolved.length === 0) {
    throw new WorkspaceAgentInvocationError('no_agent_participant')
  }
  const failures: unknown[] = []
  // An outside agent runs on its own machine: its message is queued for it to collect, and no run is opened.
  const outside = resolved.filter((invocation) => invocation.harness === 'mcp')
  const invocations = resolved.filter((invocation) => invocation.harness !== 'mcp')
  const queued = outside.length === 0 ? [] : await (dependencies.deliverToOutsideAgents
    ?? ((delivery) => getOverlayServerContext().mcpAgentNetwork.deliver(delivery)))({
    actorUserId: args.actorUserId, workspaceId: args.workspaceId, conversationId: args.conversationId, messageId: args.messageId,
    prompt: args.prompt, ...(args.threadRootMessageId ? { threadRootMessageId: args.threadRootMessageId } : {}),
    targets: outside.map((invocation) => ({ agentId: invocation.agentId, turnId: invocation.turnId })),
  }).catch((error) => {
    logger.error('[conversations/message POST] Failed to queue a message for an outside agent', { conversationId: args.conversationId, error, messageId: args.messageId })
    failures.push(error)
    return []
  })
  const queuedInvocations = outside.flatMap((invocation) => {
    const delivered = queued.find((entry) => entry.agentId === invocation.agentId)
    return delivered ? [{ ...invocation, availability: delivered.availability }] : []
  })
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
      await (dependencies.requireExecution ?? requireWorkspaceExecution)({
        userId: args.actorUserId,
        workspaceId: args.workspaceId,
        checkBudget: false,
      })
      const turn = await collaboration.startAgentTurn({
        actorUserId: args.actorUserId,
        agentId: invocation.agentId,
        authorPrincipalId: invocation.agentPrincipalId,
        clientNonce: invocation.invocationNonce,
        conversationId: args.conversationId,
        executionEngine: 'overlay_harness',
        initiatorPrincipalId: args.initiatorPrincipalId,
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
      await (dependencies.requireExecution ?? requireWorkspaceExecution)({
        userId: args.actorUserId,
        workspaceId: args.workspaceId,
        checkBudget: true,
      })
      await (dependencies.startNative ?? startNativeHarnessTurn)({
        actorUserId: args.actorUserId,
        workspaceId: args.workspaceId,
        conversationId: args.conversationId,
        runId: turn.runId,
        memoryEnabled: args.memoryEnabled,
        ...(args.threadRootMessageId ? { threadRootMessageId: args.threadRootMessageId } : {}),
      })
    } catch (error) {
      failures.push(error)
      const turnErrorCode = error instanceof WorkspaceAgentInvocationError ? error.reasonCode : 'unexpected'
      const turnErrorDetail = error instanceof Error ? error.message.slice(0, 300) : String(error).slice(0, 300)
      logger.error(`[conversations/message POST] Failed to start an agent turn: ${turnErrorCode} ${turnErrorDetail}`, {
        agentId: invocation.agentId,
        conversationId: args.conversationId,
        error,
        messageId: args.messageId,
      })
      const failureMessage = agentStartFailureMessage(invocation.agentName, error)
      await collaboration.recordAgentStartFailure({
        actorUserId: args.actorUserId,
        authorPrincipalId: invocation.agentPrincipalId,
        clientNonce: invocation.invocationNonce,
        content: failureMessage,
        conversationId: args.conversationId,
        failure: agentStartFailureReason(error),
        modelId: invocation.modelId,
        threadRootMessageId: args.threadRootMessageId,
        turnId: invocation.turnId,
        workspaceId: args.workspaceId,
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
  if (args.strictErrors && failures.length > 0) {
    throw failures[0] instanceof Error ? failures[0] : new Error('Agent turn could not be started.')
  }
  return [...invocations, ...queuedInvocations]
}
