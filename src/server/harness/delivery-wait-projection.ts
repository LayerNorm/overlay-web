import 'server-only'

import type { HarnessWait } from '@overlay/agent-runtime/harness-store'
import type { AgentRun } from '@/shared/agents/agent-run'
import { isTerminalAgentRunStatus } from '@/shared/agents/agent-run'
import { getOverlayServerContext } from '@/server/bootstrap'
import { ConvexHarnessRepository } from './ConvexHarnessRepository'
import type { HarnessExecutionReference } from './state-steps'

export type HarnessWaitProjection = { wait: HarnessWait } | { status: 'running' | 'waiting_for_children' }
type DeliveryReference = HarnessExecutionReference & { agentRunId: string }

export async function projectHarnessDeliveryWait(
  access: DeliveryReference,
  run: AgentRun,
  projection: HarnessWaitProjection,
): Promise<'projected' | 'stale' | 'inactive'> {
  if (isTerminalAgentRunStatus(run.status)) return 'inactive'
  const repository = new ConvexHarnessRepository()
  const wait = 'wait' in projection
    ? (await repository.listPendingWaits(access)).find(candidate => candidate.token === projection.wait.token)
    : undefined
  if ('wait' in projection && !wait) return 'stale'
  const status = wait ? (wait.kind === 'input' ? 'waiting_for_input' : 'waiting_for_approval')
    : (projection as { status: 'running' | 'waiting_for_children' }).status
  if (run.status === status && (!wait || (wait.kind === 'input'
    ? run.inputRequest?.token === wait.token : run.approval?.token === wait.token))) return 'projected'
  const conversations = getOverlayServerContext().appData.repositories.conversations
  const identity = { runId: access.agentRunId, userId: access.actorUserId, expectedWorkflowRunId: access.workflowRunId }
  if (run.status !== 'running') await conversations.transitionAgentRun({ ...identity, status: 'running' })
  if (status !== 'running') await conversations.transitionAgentRun({
    ...identity, status,
    ...(wait?.kind === 'input' ? { inputRequest: { token: wait.token, question: wait.question, requestedAt: wait.createdAt } } : {}),
    ...(wait?.kind === 'approval' ? { approval: { token: wait.token, title: wait.question, requestedAt: wait.createdAt, requests: wait.requests } } : {}),
  })
  return 'projected'
}
