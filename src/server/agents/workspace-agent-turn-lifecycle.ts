import 'server-only'

import {
  runWorkspaceAgentTurn,
  type WorkspaceAgentTurnResult,
} from '@/server/agents/workspace-agent-invocation'
import {
  prepareWorkspaceAgentTurn as prepare,
  beginWorkspaceAgentModelCall as beginModelCall,
  callWorkspaceAgentModel as model,
  inspectWorkspaceAgentTool as inspect,
  executeWorkspaceAgentTool as execute,
  finalizeWorkspaceAgentTurn as finalize,
  persistWorkspaceAgentToolProgress as persistToolProgress,
} from './workspace-agent-durable'
import {
  settleWorkspaceAgentUsage as settleUsage,
  releaseWorkspaceAgentReservation as releaseReservation,
} from './workspace-agent-usage'
import type { AgentRunApprovalRequest } from '@/shared/agents/agent-run'
import { resumeHook } from 'workflow/api'
import { getOverlayServerContext } from '@/server/bootstrap'
import { agentRunService } from '@/server/conversations/http'

/**
 * The durable steps of a room agent turn.
 *
 * Each is a `"use step"` so the workflow that runs them can be replayed: the
 * turn survives the request that triggered it, and a run the platform reclaims
 * mid-flight is retried rather than silently lost.
 */

export async function attachWorkspaceAgentRun(input: {
  actorUserId: string
  runId: string
  workflowRunId: string
}) {
  'use step'
  return await agentRunService.attachWorkflow({
    runId: input.runId,
    userId: input.actorUserId,
    workflowRunId: input.workflowRunId,
  })
}

export async function executeWorkspaceAgentTurn(input: {
  actorUserId: string
  agentId: string
  conversationId: string
  messageId: string
  memoryEnabled: boolean
  threadRootMessageId?: string
  turnMessageId: string
  workspaceId: string
}): Promise<WorkspaceAgentTurnResult | null> {
  'use step'
  // No access token: a durable turn can start long after the request that
  // triggered it, so it must not depend on a credential from that request.
  // Agent tools authenticate as the summoning human through the server secret.
  return await runWorkspaceAgentTurn({
    actorUserId: input.actorUserId,
    agentId: input.agentId,
    conversationId: input.conversationId,
    existingMessageId: input.turnMessageId,
    messageId: input.messageId,
    memoryEnabled: input.memoryEnabled,
    threadRootMessageId: input.threadRootMessageId,
    workspaceId: input.workspaceId,
  })
}

export const prepareWorkspaceAgentTurn = prepare
export const beginWorkspaceAgentModelCall = beginModelCall
export const callWorkspaceAgentModel = model
export const inspectWorkspaceAgentTool = inspect
export const executeWorkspaceAgentTool = execute
export const persistWorkspaceAgentToolProgress = persistToolProgress
export const finalizeWorkspaceAgentTurn = finalize
export const settleWorkspaceAgentUsage = settleUsage
export const releaseWorkspaceAgentReservation = releaseReservation

export async function waitForWorkspaceAgentApproval(input: {
  actorUserId: string
  runId: string
  token: string
  requests: AgentRunApprovalRequest[]
}) {
  'use step'
  return await agentRunService.waitForApproval({
    runId: input.runId,
    userId: input.actorUserId,
    leaseExpiresAt: Date.now() + 30 * 60_000,
    approval: { token: input.token, requestedAt: Date.now(), requests: input.requests, title: 'Approval required' },
  })
}

export async function denyExpiredWorkspaceAgentApproval(input: { token: string }) {
  'use step'
  await resumeHook(input.token, { approved: false, reason: 'Approval timed out.' })
}

export async function resumeWorkspaceAgentAfterApproval(input: { actorUserId: string; runId: string }) {
  'use step'
  return await agentRunService.resumeAfterApproval({ runId: input.runId, userId: input.actorUserId })
}

export async function completeWorkspaceAgentRun(input: {
  actorUserId: string
  result: WorkspaceAgentTurnResult
  runId: string
}) {
  'use step'
  return await agentRunService.complete({
    content: input.result.content,
    parts: input.result.parts,
    routedModelId: input.result.modelId,
    runId: input.runId,
    tokens: input.result.tokens,
    userId: input.actorUserId,
  })
}

/**
 * Closes a turn that produced nothing. The reply row is already terminal by
 * this point — `runWorkspaceAgentTurn` failed it — so this only settles the run
 * record that owns it.
 */
export async function abandonWorkspaceAgentRun(input: {
  actorUserId: string
  reasonCode: string
  runId: string
}) {
  'use step'
  return await agentRunService.fail({
    error: { code: input.reasonCode, message: 'The agent produced no reply.', retryable: true },
    errorText: 'The agent produced no reply.',
    runId: input.runId,
    userId: input.actorUserId,
  })
}

export async function failWorkspaceAgentRun(input: {
  actorUserId: string
  conversationId: string
  errorMessage: string
  reasonCode: string
  retryable: boolean
  runId: string
  turnMessageId: string
  workspaceId: string
}) {
  'use step'
  const collaboration = getOverlayServerContext().appData.repositories.conversationCollaboration
  // Close the reply row first, keeping whatever text arrived. `failAgentRun`
  // only rewrites a row that is still generating, so settling it here is what
  // preserves a partial reply instead of replacing it with the error text.
  await collaboration.failAgentMessage({
    actorUserId: input.actorUserId,
    conversationId: input.conversationId,
    messageId: input.turnMessageId,
    workspaceId: input.workspaceId,
  }).catch((_error) => undefined)
  return await agentRunService.fail({
    error: { code: input.reasonCode, message: input.errorMessage, retryable: input.retryable },
    errorText: input.errorMessage,
    runId: input.runId,
    userId: input.actorUserId,
  })
}
