import { getWorkflowMetadata } from 'workflow'
import {
  abandonWorkspaceAgentRun,
  attachWorkspaceAgentRun,
  completeWorkspaceAgentRun,
  executeWorkspaceAgentTurn,
  failWorkspaceAgentRun,
} from '@/server/agents/workspace-agent-turn-lifecycle'

/**
 * Reason code and retryability for a failed turn.
 *
 * Deliberately kept inside the workflow module and free of imports. Anything a
 * workflow body pulls in that is not a `"use step"` function is bundled for the
 * workflow runtime, where Node built-ins do not exist — importing this from the
 * server would drag `node:crypto` in behind it and fail the build. The error is
 * matched by name rather than by class for the same reason.
 */
function describeWorkspaceAgentFailure(error: unknown): {
  errorMessage: string
  reasonCode: string
  retryable: boolean
} {
  const reasonCode = error instanceof Error && error.name === 'WorkspaceAgentInvocationError'
    ? String((error as { reasonCode?: unknown }).reasonCode ?? 'model_failed')
    : 'model_failed'
  return {
    errorMessage: error instanceof Error ? error.message : 'The agent turn failed.',
    reasonCode,
    // An entitlement or usage refusal will refuse again; retrying it only burns
    // the run. Everything else is worth another attempt.
    retryable: reasonCode !== 'not_entitled'
      && reasonCode !== 'usage_limited'
      && reasonCode !== 'room_access_denied'
      && reasonCode !== 'not_a_collaboration_room',
  }
}

export type WorkspaceAgentTurnInput = {
  actorUserId: string
  agentId: string
  conversationId: string
  /** The human message being replied to. */
  messageId: string
  memoryEnabled?: boolean
  runId: string
  threadRootMessageId?: string
  /** The `generating` reply row opened with the run record. */
  turnMessageId: string
  workspaceId: string
}

/**
 * One room agent's reply, as a durable run.
 *
 * The point of the workflow is ownership: the turn belongs to the run record
 * rather than to an HTTP request, so closing the tab, navigating away, or
 * losing the serverless instance cannot end it. The reply is already a row in
 * the transcript before this starts, so wherever the reader goes, they come
 * back to it.
 *
 * This deliberately runs the existing model turn as a single step rather than
 * as a `WorkflowAgent` loop. Replay granularity is therefore the whole turn:
 * a crash re-runs it from the top instead of resuming at the last tool call.
 * That trade buys token-level streaming, which a `WorkflowAgent` cannot give a
 * transcript row — it streams into the workflow's own output stream, which
 * only the single holder of the run id can read. Rooms need every participant
 * to see the reply, so the row wins. See docs/develop/bring-your-own-agents.md, "Durable agent
 * runs", for the follow-up that revisits this.
 */
export async function workspaceAgentTurnWorkflow(input: WorkspaceAgentTurnInput) {
  'use workflow'

  const { workflowRunId } = getWorkflowMetadata()
  await attachWorkspaceAgentRun({
    actorUserId: input.actorUserId,
    runId: input.runId,
    workflowRunId,
  })

  try {
    const result = await executeWorkspaceAgentTurn({
      actorUserId: input.actorUserId,
      agentId: input.agentId,
      conversationId: input.conversationId,
      messageId: input.messageId,
      memoryEnabled: input.memoryEnabled !== false,
      threadRootMessageId: input.threadRootMessageId,
      turnMessageId: input.turnMessageId,
      workspaceId: input.workspaceId,
    })
    if (!result) {
      // The turn ran and produced nothing — an empty completion, or a reply
      // this agent had already posted. Either way there is nothing to record,
      // and the run must not stay active.
      await abandonWorkspaceAgentRun({
        actorUserId: input.actorUserId,
        reasonCode: 'empty_response',
        runId: input.runId,
      })
      return { completed: false, runId: input.runId }
    }
    await completeWorkspaceAgentRun({
      actorUserId: input.actorUserId,
      result,
      runId: input.runId,
    })
    return { completed: true, runId: input.runId }
  } catch (error) {
    const failure = describeWorkspaceAgentFailure(error)
    await failWorkspaceAgentRun({
      actorUserId: input.actorUserId,
      conversationId: input.conversationId,
      errorMessage: failure.errorMessage,
      reasonCode: failure.reasonCode,
      retryable: failure.retryable,
      runId: input.runId,
      turnMessageId: input.turnMessageId,
      workspaceId: input.workspaceId,
    })
    throw error
  }
}
