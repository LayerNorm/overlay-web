import 'server-only'

import { resumeHook } from 'workflow/api'
import type { AgentRun } from '@/shared/agents/agent-run'
import { asConversationId } from '@/server/conversations/ActConversationRepository'
import { agentRunApprovalAccess, type AgentRunApprovalAccess } from '@/server/agents/agent-approval-authority'
import { ConvexHarnessRepository } from '@/server/harness/ConvexHarnessRepository'

export type AgentRunApprovalDecision = { approved: boolean; reason?: string }

export type SubmitAgentRunApprovalDependencies = {
  getLatestAgentRun: (args: { conversationId: ReturnType<typeof asConversationId>; agentRunId: string; userId: string }) => Promise<AgentRun | null>
  resume?: (token: string, decision: AgentRunApprovalDecision) => Promise<unknown>
  /** null skips the Harness wait, for callers that inject only a hook. */
  submitWaitReply?: ConvexHarnessRepository['submitWaitReply'] | null
}

/**
 * Answers a run's approval request for the person who started it, from the web or from Slack. The run must still be
 * waiting on the same request; a Harness run takes the answer through its wait, an older run through its hook.
 */
export async function submitAgentRunApproval(
  args: {
    actorUserId: string
    workspaceId: string
    conversationId: string
    agentRunId: string
    token: string
    decision: AgentRunApprovalDecision
  },
  dependencies: SubmitAgentRunApprovalDependencies,
): Promise<AgentRunApprovalAccess> {
  const run = await dependencies.getLatestAgentRun({
    conversationId: asConversationId(args.conversationId),
    agentRunId: args.agentRunId,
    userId: args.actorUserId,
  })
  const access = agentRunApprovalAccess(run, {
    actorUserId: args.actorUserId,
    agentRunId: args.agentRunId,
    conversationId: args.conversationId,
    token: args.token,
  })
  if (access !== 'allowed') return access
  const decision = { approved: args.decision.approved, ...(args.decision.reason ? { reason: args.decision.reason } : {}) }
  const submit = dependencies.submitWaitReply !== undefined ? dependencies.submitWaitReply
    : ((input: Parameters<ConvexHarnessRepository['submitWaitReply']>[0]) => new ConvexHarnessRepository().submitWaitReply(input))
  if (run?.harnessRunId && submit && await submit({
    actorUserId: args.actorUserId, workspaceId: args.workspaceId, deliveryAgentRunId: run.id, token: args.token, reply: decision,
  })) return 'allowed'
  await (dependencies.resume ?? resumeHook)(args.token, decision)
  return 'allowed'
}
