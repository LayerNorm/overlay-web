import 'server-only'
import { ConvexHarnessRepository } from './ConvexHarnessRepository'
import { buildNativeHarnessWorkflowInput } from './native-workflow-input-builder'
import { dispatchNativeHarnessAgentRequest } from './native-tool-steps'
import { startNativeHarnessTurn } from './native-turn-start'
import { cancelHarnessWorkflow } from './workflow-cancellation'
import { cancelPersonalHarnessWorkflows } from './personal-cancellation'
import { finishNativeHarnessDelivery } from './native-delivery-steps'
import { readHarnessTranscriptForDelivery } from './harness-transcript'
import { buildNativeHarnessDelivery } from './native-tool-metrics'
import { notifyHarnessAncestors } from './personal-wait-steps'
import type { NativeRecoveryRequest, NativeRecoveryWork } from '@/shared/agents/assignment-recovery'
import type { HarnessExecutionResult } from './runner'

export async function readNativeRecoveryWork(request: NativeRecoveryRequest) {
  'use step'
  return await new ConvexHarnessRepository().getNativeRecoveryWork(request)
}

export async function acknowledgeNativeRecoveryWork(request: NativeRecoveryRequest) {
  'use step'
  await new ConvexHarnessRepository().acknowledgeNativeRecovery(request)
}

export async function executeNativeRecoveryWork(work: NativeRecoveryWork) {
  'use step'
  if (work.kind === 'cancel') {
    for (const workflowRunId of work.workflows) await cancelHarnessWorkflow(workflowRunId)
    if (work.cancellationRoot) await cancelPersonalHarnessWorkflows(work.cancellationRoot)
    return
  }
  if (work.kind === 'turn') {
    await startNativeHarnessTurn({ actorUserId: work.actorUserId, workspaceId: work.workspaceId,
      conversationId: work.conversationId, runId: work.deliveryRunId, memoryEnabled: work.memoryEnabled ?? false })
    return
  }
  const repository = new ConvexHarnessRepository()
  const runId = work.kind === 'assignment' ? work.parentRunId : work.runId
  const state = await repository.get({ actorUserId: work.actorUserId, runId })
  if (!state || state.workflowRunId !== work.workflowRunId || (state.executionGeneration ?? 0) !== work.executionGeneration) return
  const root = await repository.get({ actorUserId: work.actorUserId, runId: state.rootRunId })
  const input = await buildNativeHarnessWorkflowInput({ actorUserId: work.actorUserId, workspaceId: work.workspaceId,
    conversationId: work.conversationId, runId: work.deliveryRunId, memoryEnabled: false,
    parentRunId: state.parentRunId, surfaceRootRunId: state.rootRunId, expectedSurfaceWorkflowRunId: root?.workflowRunId })
  const access = { ...input.access, runId: state.runId, workflowRunId: work.workflowRunId, executionGeneration: work.executionGeneration }
  if (work.kind === 'assignment') {
    await dispatchNativeHarnessAgentRequest(access, input.context, work.toolCallId, 'ask_agent', {
      agent: work.agentId, message: work.brief, assignmentId: work.assignmentId, expectedAttemptId: work.expectedAttemptId, wait: false,
    })
    return
  }
  if (!['completed', 'failed', 'cancelled'].includes(state.status)) return
  const result: HarnessExecutionResult = { outcome: 'finished', snapshot: state, messages: [], steps: [], stepReceiptIds: [] }
  const journal = await readHarnessTranscriptForDelivery(access, result)
  const toolNames = new Set(input.definitions.map(definition => definition.name))
  await finishNativeHarnessDelivery(access, buildNativeHarnessDelivery(result, toolNames, journal), { memoryEnabled: work.memoryEnabled ?? false }, toolNames)
  await repository.settleAssignmentResult(state.runId)
  if (state.parentRunId) await notifyHarnessAncestors(access)
}
