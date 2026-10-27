import { createHook, FatalError, getWorkflowMetadata } from 'workflow'
import { start } from 'workflow/api'
import type { HarnessSnapshot } from '@overlay/agent-runtime/harness-state'
import { createNativeHarnessTools } from '@/server/harness/native-tools'
import { createNativeHarnessExecutionPorts } from '@/server/harness/native-ports'
import { createHarnessWaitPorts } from '@/server/harness/waits'
import { admitNativeHarnessChild } from '@/server/harness/native-child-steps'
import { buildPersonalHarnessDelivery } from '@/server/harness/personal-delivery'
import {
  attachNativeHarnessDelivery, finishNativeHarnessDelivery, projectNativeHarnessWait, writeNativeHarnessFallback,
} from '@/server/harness/native-delivery-steps'
import { notifyHarnessAncestors, readHarnessChild } from '@/server/harness/personal-wait-steps'
import { harnessWakeToken } from '@/server/harness/wait-token'
import { applyHarnessOperation, claimHarnessState, readHarnessState } from '@/server/harness/state-steps'
import { runOverlayHarness, type HarnessExecutionResult } from '@/server/harness/runner'
import type { NativeHarnessAccess } from '@/server/harness/native-access'
import type { NativeHarnessWorkflowInput } from '@/server/harness/native-workflow-input'

export async function startNativeHarnessChild(parent: NativeHarnessAccess, input: NativeHarnessWorkflowInput): Promise<string> {
  'use step'
  const { ConvexHarnessRepository } = await import('@/server/harness/ConvexHarnessRepository')
  const repository = new ConvexHarnessRepository()
  const parentState = await repository.get(parent)
  const child = await repository.get({ actorUserId: parent.actorUserId, runId: input.access.runId })
  const identity = ['actorUserId', 'workspaceId', 'principalId', 'agentId', 'agentPrincipalId',
    'conversationId', 'agentRunId', 'userMessageId', 'assistantMessageId', 'turnId'] as const
  if (!parentState || parentState.runId !== parent.runId || parentState.workflowRunId !== parent.workflowRunId
    || parentState.policy.actorUserId !== parent.actorUserId || parentState.policy.workspaceId !== parent.workspaceId
    || !parentState.children.some(entry => entry.id === child?.runId)
    || !child || child.parentRunId !== parent.runId || child.rootRunId !== parentState.rootRunId
    || identity.some(key => input.access[key] !== parent[key])
    || ['completed', 'failed', 'cancelled'].includes(parentState.status)
    || ['completed', 'failed', 'cancelled'].includes(child.status)) {
    throw new FatalError('Invalid native child launch authority.')
  }
  if (child.workflowRunId) return child.workflowRunId
  return (await start(nativeHarnessWorkflow, [input])).runId
}

export function nativeHarnessChildInput(parent: NativeHarnessWorkflowInput, child: HarnessSnapshot): NativeHarnessWorkflowInput {
  const allowed = new Set(child.policy.allowedToolIds)
  return {
    access: { ...parent.access, runId: child.runId },
    context: parent.context,
    definitions: parent.definitions.filter(definition => allowed.has(definition.name)),
    settings: parent.settings, modelCandidates: parent.modelCandidates,
    instructions: `${parent.instructions}\n\nComplete only the assigned bounded task. Return concise findings with evidence references and any blockers. Do not expand the scope or contact the user except through the harness input mechanism.`,
    messages: [{ role: 'user', content: JSON.stringify({ goal: child.goal, constraints: child.constraints }) }],
  }
}

export async function nativeHarnessWorkflow(input: NativeHarnessWorkflowInput) {
  'use workflow'
  const { workflowRunId } = getWorkflowMetadata()
  const access = { ...input.access, workflowRunId }
  const initial = await readHarnessState(access)
  if (['completed', 'failed', 'cancelled'].includes(initial.status)) return { runId: initial.runId, status: initial.status }
  if (!await claimHarnessState(access)) return { runId: initial.runId, status: 'already_running' }
  const owns = initial.runId === `workspace:${access.agentRunId}`
  using wake = createHook<unknown>({ token: harnessWakeToken(workflowRunId) })
  let result: HarnessExecutionResult | undefined
  const fallbackNotices: string[] = []
  try {
    if (await wake.getConflict()) throw new FatalError('Harness wake channel is already owned.')
    if (owns) await attachNativeHarnessDelivery(access)
    const execution = { access, context: input.context }
    const ports = createNativeHarnessExecutionPorts(execution, {
      ...createHarnessWaitPorts({
        reference: access, deliveryRunId: `workspace:${access.agentRunId}`, wake: wake[Symbol.asyncIterator](),
        projectWait: projection => projectNativeHarnessWait(access, projection),
      }),
      readChild: childRunId => readHarnessChild(access, childRunId),
      delegate: async (delegation, toolCallId) => {
        const child = await admitNativeHarnessChild(execution, delegation, toolCallId)
        const snapshot = await readHarnessChild(access, child.id)
        await startNativeHarnessChild(access, nativeHarnessChildInput(input, snapshot))
        return child
      },
      recordToolResult: async event => {
        const state = await readHarnessState(access)
        if (['completed', 'failed', 'cancelled'].includes(state.status)) return
        const value = event.success ? event.output : event.error instanceof Error ? event.error.message : event.error
        const summary = (typeof value === 'string' ? value : JSON.stringify(value))
          || (event.success ? 'Tool completed without an output.' : 'Tool failed.')
        await applyHarnessOperation(access, `tool-evidence:${event.toolCall.toolCallId}`, { type: 'record_evidence', evidence: {
          id: `tool:${event.toolCall.toolCallId}`, kind: 'tool_result', source: event.toolCall.toolName,
          summary: summary.slice(0, 2_000), verdict: event.success ? 'observed' : 'failed', createdAt: Date.now(),
        } })
      },
    }, input.modelCandidates ? {
      candidateIds: input.modelCandidates,
      onFallback: owns ? async event => { fallbackNotices.push(await writeNativeHarnessFallback(access, event)) } : undefined,
    } : undefined)
    result = await runOverlayHarness({
      instructions: input.instructions, messages: input.messages, settings: input.settings,
      model: { modelId: input.context.modelId, credentialOwnerId: access.actorUserId,
        sessionId: access.conversationId, allowLowBalanceFallback: false },
      tools: createNativeHarnessTools({ access, context: input.context, definitions: input.definitions }),
    }, ports)
    if (result.outcome === 'already_running') return { runId: initial.runId, status: 'already_running' }
    if (!['completed', 'failed', 'cancelled'].includes(result.snapshot.status)) {
      result.snapshot = await applyHarnessOperation(access, 'blocked-finalization', {
        type: 'terminate', status: 'failed', reason: result.snapshot.blocker?.question || 'The task is blocked and cannot continue.',
      })
    }
  } catch (error) {
    const reason = (error instanceof Error ? error.message : 'Harness execution failed.').slice(0, 2_000)
    const state = await readHarnessState(access)
    const snapshot = ['completed', 'failed', 'cancelled'].includes(state.status) ? state
      : await applyHarnessOperation(access, 'execution-failed', { type: 'terminate', status: 'failed', reason })
    result = { outcome: 'finished', snapshot, messages: [], steps: [] }
  }
  if (owns) {
    const delivery = buildPersonalHarnessDelivery(result, undefined, fallbackNotices)
    await finishNativeHarnessDelivery(access, delivery, { memoryEnabled: input.context.memoryEnabled })
  } else {
    await notifyHarnessAncestors(access)
  }
  return { runId: result.snapshot.runId, status: result.snapshot.status }
}
