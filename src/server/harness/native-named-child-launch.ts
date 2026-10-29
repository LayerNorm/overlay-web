import 'server-only'

import { FatalError } from 'workflow'
import { start } from 'workflow/api'
import type { HarnessSnapshot } from '@overlay/agent-runtime/harness-state'
import type { AgentRun } from '@/shared/agents/agent-run'
import { asConversationId } from '@/server/conversations/ActConversationRepository'
import { getOverlayServerContext } from '@/server/bootstrap'
import { ConvexHarnessRepository } from './ConvexHarnessRepository'
import type { NativeHarnessAccess } from './native-access'
import type { NativeHarnessWorkflowInput } from './native-workflow-input'

function isTerminal(status: string): boolean {
  return ['completed', 'failed', 'cancelled'].includes(status)
}

function assertParentState(
  parent: NativeHarnessAccess,
  state: HarnessSnapshot | null,
): asserts state is HarnessSnapshot {
  if (!state || state.runId !== parent.runId || state.workflowRunId !== parent.workflowRunId
    || state.policy.actorUserId !== parent.actorUserId || state.policy.workspaceId !== parent.workspaceId
    || isTerminal(state.status)) {
    throw new FatalError('Invalid native named-child launch authority.')
  }
}

function assertChildState(
  parent: NativeHarnessAccess,
  parentState: HarnessSnapshot,
  child: HarnessSnapshot | null,
  access: NativeHarnessWorkflowInput['access'],
  childRunId: string,
): asserts child is HarnessSnapshot {
  if (!child || child.runId !== childRunId || child.parentRunId !== parent.runId
    || child.rootRunId !== parentState.rootRunId || child.depth !== parentState.depth + 1
    || child.policy.actorUserId !== parent.actorUserId || child.policy.workspaceId !== parent.workspaceId
    || !parentState.children.some(entry => entry.id === childRunId && entry.status === 'running')
    || isTerminal(child.status) || access.actorUserId !== parent.actorUserId
    || access.workspaceId !== parent.workspaceId || access.principalId !== parent.agentPrincipalId
    || access.runId !== childRunId || access.runId !== `workspace:${access.agentRunId}`) {
    throw new FatalError('Invalid native named-child launch authority.')
  }
}

function assertDeliveryIdentity(
  run: AgentRun | null,
  child: HarnessSnapshot,
  access: NativeHarnessWorkflowInput['access'],
  childRunId: string,
): asserts run is AgentRun {
  if (!run || run.id !== access.agentRunId || run.userId !== access.actorUserId
    || run.conversationId !== access.conversationId || run.agentId !== access.agentId
    || run.agentPrincipalId !== access.agentPrincipalId || run.turnId !== access.turnId
    || run.userMessageId !== access.userMessageId || run.assistantMessageId !== access.assistantMessageId
    || run.initiatorPrincipalId !== access.principalId || run.mode !== 'room' || run.runner !== 'workflow'
    || run.executionEngine !== 'overlay_harness' || run.harnessRunId !== childRunId
    || (child.workflowRunId !== undefined && run.workflowRunId !== child.workflowRunId)) {
    throw new FatalError('Native named-child delivery identity changed.')
  }
}

export async function startNativeHarnessNamedChild(
  parent: NativeHarnessAccess,
  input: NativeHarnessWorkflowInput,
  childRunId: string,
): Promise<string> {
  'use step'
  const repository = new ConvexHarnessRepository()
  const parentState = await repository.get(parent)
  const child = await repository.get({ actorUserId: parent.actorUserId, runId: childRunId })
  const access = input.access
  assertParentState(parent, parentState)
  assertChildState(parent, parentState, child, access, childRunId)
  const run = await getOverlayServerContext().appData.repositories.conversations.getLatestAgentRun({
    agentRunId: access.agentRunId,
    conversationId: asConversationId(access.conversationId),
    userId: access.actorUserId,
  }) as AgentRun | null
  assertDeliveryIdentity(run, child, access, childRunId)
  if (run.workflowRunId) return run.workflowRunId
  if (child.workflowRunId) throw new FatalError('Native named-child delivery identity changed.')
  const { nativeHarnessWorkflow } = await import('@/server/workflows/native-harness')
  return (await start(nativeHarnessWorkflow, [input])).runId
}

startNativeHarnessNamedChild.maxRetries = 0
