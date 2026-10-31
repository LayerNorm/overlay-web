import type { AgentRun } from '@/shared/agents/agent-run'
import { isRetiredNativeRun } from '@/shared/agents/native-run-retirement'

export type AgentRunApprovalAccess = 'allowed' | 'inactive' | 'initiator-only' | 'retired'

export function agentRunApprovalAccess(
  run: AgentRun | null | undefined,
  request: {
    actorUserId: string
    agentRunId: string
    conversationId: string
    token: string
  },
): AgentRunApprovalAccess {
  if (
    !run ||
    run.id !== request.agentRunId ||
    run.conversationId !== request.conversationId ||
    run.status !== 'waiting_for_approval' ||
    run.approval?.token !== request.token
  ) return 'inactive'
  if (run.userId !== request.actorUserId) return 'initiator-only'
  if (isRetiredNativeRun(run)) return 'retired'
  return 'allowed'
}
