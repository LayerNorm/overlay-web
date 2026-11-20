import 'server-only'

import { FatalError } from 'workflow'
import { ConvexError } from 'convex/values'
import type { getOverlayServerContext } from '@/server/bootstrap'
import type { ConvexHarnessRepository } from './ConvexHarnessRepository'
import { cancelHarnessWorkflow } from './workflow-cancellation'
import { cancelPersonalHarnessWorkflows } from './personal-cancellation'
import type { NativeHarnessAccess } from './native-access'

export async function resolveNativeAssignment(access: NativeHarnessAccess, values: Record<string, unknown>, repository: ConvexHarnessRepository) {
  if (typeof values.assignmentId !== 'string' || typeof values.attemptId !== 'string'
    || !['accept', 'exclude', 'cancel'].includes(String(values.action))
    || (values.reason !== undefined && typeof values.reason !== 'string')) throw new FatalError('Invalid assignment resolution.')
  let resolution: Awaited<ReturnType<ConvexHarnessRepository['resolveAssignment']>>
  try {
    resolution = await repository.resolveAssignment({ actorUserId: access.actorUserId, workspaceId: access.workspaceId,
      parentRunId: access.runId, workflowRunId: access.workflowRunId, executionGeneration: access.executionGeneration ?? 0,
      assignmentId: values.assignmentId, attemptId: values.attemptId, action: values.action as 'accept' | 'exclude' | 'cancel', reason: values.reason as string | undefined })
  } catch (error) {
    const feedback = error instanceof ConvexError ? error.data : null
    if (!feedback || typeof feedback !== 'object' || feedback.code !== 'ASSIGNMENT_RESOLUTION_REJECTED'
      || typeof feedback.error !== 'string' || typeof feedback.hint !== 'string') throw error
    return { success: false, code: feedback.code, error: feedback.error, hint: feedback.hint,
      ...(typeof feedback.currentAttemptId === 'string' ? { currentAttemptId: feedback.currentAttemptId } : {}) }
  }
  for (const workflowRunId of resolution.workflows) await cancelHarnessWorkflow(workflowRunId)
  if (resolution.cancellationRoot) await cancelPersonalHarnessWorkflows(resolution.cancellationRoot)
  return { assignmentId: resolution.assignmentId, attemptId: resolution.attemptId, disposition: resolution.disposition, reason: resolution.reason }
}

export function assertNativeAgentRequest(toolCallId: string, toolName: string) {
  if (!toolCallId || toolCallId.length > 256 || !['list_agents', 'ask_agent', 'post_message', 'resolve_assignment'].includes(toolName)) {
    throw new FatalError('Invalid native agent request.')
  }
}

export async function assertNativeAskTargetAccess(
  server: ReturnType<typeof getOverlayServerContext>,
  actorUserId: string,
  workspaceId: string,
  target: string,
): Promise<void> {
  const directory = await server.workspaceAgentService.list({ actorUserId, workspaceId })
  const normalizedTarget = target.trim().toLocaleLowerCase()
  const targetAgent = directory.agents.find(agent => agent.id === target.trim()
    || agent.name.trim().toLocaleLowerCase() === normalizedTarget)
  if (!targetAgent) return
  if (targetAgent.harness !== 'overlay') {
    throw new FatalError("External agents can't be asked from this run yet.")
  }
}
