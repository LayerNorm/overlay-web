import { createHook, FatalError, sleep } from 'workflow'
import type { AgentRun, AgentRunApprovalRequest } from '@/shared/agents/agent-run'

export type WorkspaceAgentApprovalInput = {
  actorUserId: string
  runId: string
  token: string
  requests: AgentRunApprovalRequest[]
}

type ApprovalDecision = { approved: boolean; reason?: string }

export async function requestWorkspaceAgentApproval(
  input: WorkspaceAgentApprovalInput,
  dependencies: {
    publish(input: WorkspaceAgentApprovalInput): Promise<Pick<AgentRun, 'status' | 'approval'> | undefined>
    resume(input: { actorUserId: string; runId: string }): Promise<Pick<AgentRun, 'status'> | undefined>
  },
): Promise<ApprovalDecision> {
  const { publish, resume } = dependencies
  using hook = createHook<ApprovalDecision>({ token: input.token })
  if (await hook.getConflict()) throw new FatalError('Approval token is already in use.')
  const pending = await publish(input)
  if (pending?.status !== 'waiting_for_approval' || pending.approval?.token !== input.token) {
    throw new FatalError('The approval request could not be published.')
  }
  // Each hook.then consumes a separate event; registration above must not read a payload.
  const outcome = await Promise.race([
    hook.then(value => ({ value })),
    sleep('15m').then(() => ({ timedOut: true as const })),
  ])
  const decision = 'timedOut' in outcome
    ? { approved: false, reason: 'Approval timed out.' }
    : outcome.value
  if (!decision || typeof decision.approved !== 'boolean') {
    throw new FatalError('Approval response was malformed.')
  }
  const resumed = await resume({ actorUserId: input.actorUserId, runId: input.runId })
  if (resumed?.status !== 'running') {
    throw new FatalError('The agent run could not resume after approval.')
  }
  return decision
}
