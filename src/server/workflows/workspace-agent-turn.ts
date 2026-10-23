import { FatalError, getWorkflowMetadata } from 'workflow'
import {
  attachWorkspaceAgentRun,
  beginWorkspaceAgentModelCall,
  callWorkspaceAgentModel,
  completeWorkspaceAgentRun,
  executeWorkspaceAgentTool,
  failWorkspaceAgentRun,
  finalizeWorkspaceAgentTurn,
  inspectWorkspaceAgentTool,
  persistWorkspaceAgentToolProgress,
  prepareWorkspaceAgentTurn,
  resumeWorkspaceAgentAfterApproval,
  settleWorkspaceAgentUsage,
  waitForWorkspaceAgentApproval,
} from '@/server/agents/workspace-agent-turn-lifecycle'
import { runWorkspaceAgentTurnLoop, type WorkspaceAgentLoopUsage } from '@/server/agents/workspace-agent-turn-loop'
import { requestWorkspaceAgentApproval } from './workspace-agent-approval'

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
  const isFatal = error instanceof Error && error.name === 'FatalError'
  return {
    errorMessage: error instanceof Error ? error.message : 'The agent turn failed.',
    reasonCode,
    // An entitlement or usage refusal will refuse again; retrying it only burns
    // the run. Everything else is worth another attempt.
    retryable: !isFatal
      && reasonCode !== 'not_entitled'
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
 * Model calls and tool calls are separate durable steps. In particular, an
 * approval suspension never replays a completed provider request or tool.
 */
export async function workspaceAgentTurnWorkflow(input: WorkspaceAgentTurnInput) {
  'use workflow'

  const { workflowRunId } = getWorkflowMetadata()
  await attachWorkspaceAgentRun({
    actorUserId: input.actorUserId,
    runId: input.runId,
    workflowRunId,
  })

  let prepared: Awaited<ReturnType<typeof prepareWorkspaceAgentTurn>> | undefined
  const usage: WorkspaceAgentLoopUsage = {
    inputTokens: 0,
    outputTokens: 0,
    usageKnown: true,
    providerCallStarted: false,
    providerOutcomeAmbiguous: false,
  }
  let usageSettlementAttempted = false
  try {
    prepared = await prepareWorkspaceAgentTurn({ ...input, memoryEnabled: input.memoryEnabled !== false })
    const loop = await runWorkspaceAgentTurnLoop({
      prepared,
      usage,
      dependencies: {
        beginFirstModelCall: async () => await beginWorkspaceAgentModelCall({
          actorUserId: input.actorUserId,
          prepared: prepared!,
        }),
        callModel: callWorkspaceAgentModel,
        inspectTool: inspectWorkspaceAgentTool,
        executeTool: executeWorkspaceAgentTool,
        persistProgress: persistWorkspaceAgentToolProgress,
        finalize: finalizeWorkspaceAgentTurn,
        requestApproval: async ({ toolCall, cycle }) => {
          const token = `native-agent-approval:${input.runId}:${cycle}`
          return await requestWorkspaceAgentApproval({
            actorUserId: input.actorUserId,
            runId: input.runId,
            token,
            requests: [{
              approvalId: `${input.runId}:${toolCall.toolCallId}`,
              toolCallId: toolCall.toolCallId,
              toolName: toolCall.toolName,
              input: toolCall.input,
            }],
          }, { publish: waitForWorkspaceAgentApproval, resume: resumeWorkspaceAgentAfterApproval })
        },
      },
    })
    const result = loop.result as Awaited<ReturnType<typeof finalizeWorkspaceAgentTurn>>
    const settlement = await settleWorkspaceAgentUsage({
      actorUserId: input.actorUserId,
      prepared,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      usageKnown: usage.usageKnown,
      providerCallStarted: usage.providerCallStarted,
      providerOutcomeAmbiguous: usage.providerOutcomeAmbiguous,
    })
    if (!settlement.settled && !settlement.reconciled) {
      throw new Error('Native agent usage could not be settled.')
    }
    usageSettlementAttempted = true
    const completed = await completeWorkspaceAgentRun({ actorUserId: input.actorUserId, result, runId: input.runId })
    if (completed?.status !== 'completed') throw new FatalError('The agent run did not complete.')
    return { completed: true, runId: input.runId }
  } catch (error) {
    let settlementError: unknown
    if (prepared && !usageSettlementAttempted) {
      try {
        const settlement = await settleWorkspaceAgentUsage({
          actorUserId: input.actorUserId,
          prepared,
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          usageKnown: usage.usageKnown,
          providerCallStarted: usage.providerCallStarted,
          providerOutcomeAmbiguous: usage.providerOutcomeAmbiguous,
        })
        if (!settlement.settled && !settlement.reconciled) {
          throw new Error('Native agent usage could not be settled.')
        }
        usageSettlementAttempted = true
      } catch (settlementFailure) {
        settlementError = settlementFailure
      }
    }
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
    if (settlementError) throw settlementError
    throw error
  }
}
