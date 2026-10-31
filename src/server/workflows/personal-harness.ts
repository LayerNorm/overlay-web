import { createHook, FatalError, getWorkflowMetadata, getWritable } from 'workflow'
import { start } from 'workflow/api'
import type { ModelCallStreamPart } from '@ai-sdk/workflow'
import type { ToolSet } from 'ai'
import type { HarnessSnapshot } from '@overlay/agent-runtime/harness-state'
import { createPersonalHarnessTools } from '@/server/harness/personal-tools'
import { createPersonalHarnessExecutionPorts } from '@/server/harness/personal-ports'
import { createPersonalHarnessWaitPorts } from '@/server/harness/personal-waits'
import { admitPersonalHarnessChild } from '@/server/harness/personal-child-steps'
import { buildPersonalHarnessDelivery } from '@/server/harness/personal-delivery'
import {
  attachPersonalHarnessDelivery, closePersonalHarnessStream, finishPersonalHarnessDelivery, writePersonalHarnessFallback,
} from '@/server/harness/personal-delivery-steps'
import { notifyHarnessAncestors, readHarnessChild } from '@/server/harness/personal-wait-steps'
import { harnessWakeToken } from '@/server/harness/wait-token'
import { applyHarnessOperation, claimHarnessState, readHarnessState } from '@/server/harness/state-steps'
import { harnessToolResultEvidence } from '@/server/harness/tool-evidence'
import { runOverlayHarness, type HarnessExecutionResult } from '@/server/harness/runner'
import { HARNESS_CONTROL_TOOLS } from '@/server/harness/context'
import { stripTextualToolCalls } from '@/server/harness/textual-tool-calls'
import type { PersonalHarnessAccess } from '@/server/harness/personal-access'
import type { PersonalHarnessWorkflowInput } from '@/server/harness/personal-workflow-input'
import { persistPersonalChatWorkProgress } from '@/server/conversations/personal-chat-work-lifecycle'
import { hasSamePersonalHarnessAuthentication } from '@/server/harness/personal-authentication'

function hasChildExecutionIdentity(parent: PersonalHarnessAccess, input: PersonalHarnessWorkflowInput): boolean {
  return input.access.actorUserId === parent.actorUserId
    && input.access.agentRunId === parent.agentRunId
    && input.access.conversationId === parent.conversationId
    && input.access.workspaceId === parent.workspaceId
}

function hasChildContextAuthority(
  parent: PersonalHarnessWorkflowInput['context'],
  child: PersonalHarnessWorkflowInput['context'],
): boolean {
  return child.turnId === parent.turnId
    && child.billingProgrammaticSubjectId === parent.billingProgrammaticSubjectId
    && child.automationExecution === parent.automationExecution
    && child.automationId === parent.automationId
    && child.automationRunId === parent.automationRunId
    && child.memoryOwnerId === parent.memoryOwnerId
    && JSON.stringify(child.accountAllowedToolIds ?? []) === JSON.stringify(parent.accountAllowedToolIds ?? [])
    && JSON.stringify(child.accountAllowedConnectorIds ?? []) === JSON.stringify(parent.accountAllowedConnectorIds ?? [])
    && JSON.stringify(child.integrationToolIds ?? []) === JSON.stringify(parent.integrationToolIds ?? [])
}

function isTerminalHarnessStatus(status: string): boolean {
  return ['completed', 'failed', 'cancelled'].includes(status)
}

function childLaunchMatchesParent(
  parent: PersonalHarnessAccess,
  parentContext: PersonalHarnessWorkflowInput['context'],
  input: PersonalHarnessWorkflowInput,
  parentState: HarnessSnapshot | null,
  child: HarnessSnapshot | null,
): child is HarnessSnapshot {
  return Boolean(parentState && child
    && parentState.workflowRunId === parent.workflowRunId
    && parentState.children.some(entry => entry.id === child.runId)
    && child.parentRunId === parent.runId
    && child.rootRunId === parentState.rootRunId
    && hasChildExecutionIdentity(parent, input)
    && hasSamePersonalHarnessAuthentication(parent.authentication, input.access.authentication)
    && hasChildContextAuthority(parentContext, input.context))
}

async function startPersonalHarnessChild(
  parent: PersonalHarnessAccess,
  parentContext: PersonalHarnessWorkflowInput['context'],
  input: PersonalHarnessWorkflowInput,
): Promise<string> {
  'use step'
  const { ConvexHarnessRepository } = await import('@/server/harness/ConvexHarnessRepository')
  const repository = new ConvexHarnessRepository()
  const parentState = await repository.get(parent)
  const child = await repository.get({ actorUserId: parent.actorUserId, runId: input.access.runId })
  if (!parentState || !childLaunchMatchesParent(parent, parentContext, input, parentState, child)) {
    throw new FatalError('Invalid child launch authority.')
  }
  if (child.workflowRunId) return child.workflowRunId
  if (isTerminalHarnessStatus(parentState.status) || isTerminalHarnessStatus(child.status)) {
    throw new FatalError('Child launch is no longer active.')
  }
  // An ambiguous start can launch another workflow, but only one can claim this
  // admitted child. A losing workflow never executes a model or tool.
  return (await start(personalHarnessWorkflow, [input])).runId
}

export function personalHarnessChildInput(
  parent: PersonalHarnessWorkflowInput,
  child: HarnessSnapshot,
): PersonalHarnessWorkflowInput {
  const allowed = new Set(child.policy.allowedToolIds)
  return {
    access: { ...parent.access, runId: child.runId },
    context: { ...parent.context, latestUserText: child.goal },
    definitions: parent.definitions.filter(definition => allowed.has(definition.name)),
    settings: parent.settings,
    modelCandidates: parent.modelCandidates,
    instructions: `${parent.instructions}\n\nComplete only the assigned bounded task. Return concise findings with evidence references and any blockers. Do not expand the scope or contact the user except through the harness input mechanism.`,
    messages: [{ role: 'user', content: JSON.stringify({ goal: child.goal, constraints: child.constraints }) }],
  }
}

export async function personalHarnessWorkflow(input: PersonalHarnessWorkflowInput): Promise<{
  runId: string
  status: string
  replyText?: string
  terminalReason?: string
}> {
  'use workflow'

  const { workflowRunId } = getWorkflowMetadata()
  const access = { ...input.access, workflowRunId }
  const initial = await readHarnessState(access)
  if (['completed', 'failed', 'cancelled'].includes(initial.status)) {
    return {
      runId: initial.runId,
      status: initial.status,
      ...(initial.terminalReason ? { terminalReason: initial.terminalReason } : {}),
    }
  }
  if (!await claimHarnessState(access)) return { runId: initial.runId, status: 'already_running' }
  const isRoot = !initial.parentRunId
  using wake = createHook<unknown>({ token: harnessWakeToken(workflowRunId) })
  let result: HarnessExecutionResult | undefined
  let progress = ''
  const fallbackNotices: string[] = []
  let activeToolNames = new Set<string>(HARNESS_CONTROL_TOOLS)
  try {
    if (await wake.getConflict()) throw new FatalError('Harness wake channel is already owned.')
    if (isRoot) await attachPersonalHarnessDelivery(access)
    const execution = { access, context: input.context }
    const ports = createPersonalHarnessExecutionPorts(execution, {
      ...createPersonalHarnessWaitPorts({
        access,
        wake: wake[Symbol.asyncIterator](),
      }),
      readChild: childRunId => readHarnessChild(access, childRunId),
      delegate: async (delegation, toolCallId) => {
        const child = await admitPersonalHarnessChild(execution, delegation, toolCallId)
        const snapshot = await readHarnessChild(access, child.id)
        await startPersonalHarnessChild(access, input.context, personalHarnessChildInput(input, snapshot))
        return child
      },
      recordToolResult: async event => {
        const state = await readHarnessState(access)
        if (['completed', 'failed', 'cancelled'].includes(state.status)) return
        await applyHarnessOperation(access, `tool-evidence:${event.toolCall.toolCallId}`, {
          type: 'record_evidence', evidence: harnessToolResultEvidence(event, Date.now()),
        })
      },
    }, input.modelCandidates ? { candidateIds: input.modelCandidates,
      onFallback: isRoot ? async event => { fallbackNotices.push(await writePersonalHarnessFallback(access, event)) } : undefined,
    } : undefined)
    const recordModelStep = ports.recordModelStep
    ports.recordModelStep = async (step, receiptId) => {
      await recordModelStep(step, receiptId)
      if (isRoot && step.text) {
        const text = stripTextualToolCalls(step.text, activeToolNames)
        if (!text) return
        progress = `${progress}${progress ? '\n\n' : ''}${text}`.slice(-160_000)
        await persistPersonalChatWorkProgress({ agentRunId: access.agentRunId, resourceUserId: access.actorUserId, content: progress })
      }
    }
    const tools = createPersonalHarnessTools({ ...execution, definitions: input.definitions })
    activeToolNames = new Set([...activeToolNames, ...Object.keys(tools)])
    result = await runOverlayHarness({
      instructions: input.instructions, messages: input.messages, settings: input.settings,
      model: { modelId: input.context.effectiveModelId, credentialOwnerId: access.actorUserId, sessionId: access.conversationId, allowLowBalanceFallback: false },
      tools,
      writable: getWritable<ModelCallStreamPart<ToolSet>>(),
    }, ports)
    if (result.outcome === 'already_running') return { runId: initial.runId, status: 'already_running' as const }
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
  if (isRoot) {
    const delivery = buildPersonalHarnessDelivery(result, input.delivery?.sourceCitations, fallbackNotices, activeToolNames)
    if (!result.steps.length && progress) {
      const content = fallbackNotices.length ? `${fallbackNotices.join('\n\n')}\n\n${progress}` : progress
      delivery.content = content
      delivery.parts = [{ type: 'text', text: content }]
    }
    await finishPersonalHarnessDelivery(access, delivery, { emitWebhook: input.delivery?.emitWebhook ?? false, turnId: input.context.turnId })
  } else {
    await notifyHarnessAncestors(access)
  }
  if (input.delivery?.closeStream !== false) {
    await closePersonalHarnessStream(result.snapshot.status === 'failed' ? result.snapshot.terminalReason : undefined)
  }
  return {
    runId: result.snapshot.runId,
    status: result.snapshot.status,
    ...(result.snapshot.terminalReason ? { terminalReason: result.snapshot.terminalReason } : {}),
    ...(input.delivery?.closeStream === false && isRoot && result.snapshot.status === 'completed'
      ? { replyText: buildPersonalHarnessDelivery(result, input.delivery?.sourceCitations, fallbackNotices, activeToolNames).content }
      : {}),
  }
}
