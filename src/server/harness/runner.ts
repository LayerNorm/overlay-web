import {
  WorkflowAgent,
  type ModelCallStreamPart,
} from '@ai-sdk/workflow'
import { isLoopFinished, type ModelMessage, type StepResult, type ToolSet } from 'ai'
import {
  assertHarnessRunnable,
  HarnessBudgetExceededError,
  harnessCompletionIssues,
  hasRunnableHarnessMilestones,
  type HarnessSnapshot,
} from '@overlay/agent-runtime/harness-state'
import { createHarnessControlTools } from './control-tools'
import {
  buildHarnessInstructions, buildHarnessStepInstructions, buildHarnessStuckQuestion,
  HARNESS_CONTROL_TOOLS, harnessProgressFingerprint, hasPendingHarnessAnswer,
} from './context'
import type { HarnessApprovalRequest, HarnessExecutionPorts, HarnessModelSettings, HarnessRunnerCheckpoint } from './ports'
import { HarnessLanguageModel, type HarnessModelReference } from './secure-model'
import { createHarnessToolApprovals, type HarnessToolApprovals, type HarnessToolExecutionOptions } from './tool-approvals'
import { assertNoControlToolReplacement, prepareToolDefinitions } from './tool-definitions'
import { harnessModelResponseFailure } from './model-usage'
import { HarnessYield, runHarnessModelInvocation, terminateOnProviderFailure } from './model-recovery'
import { harnessToolInputDigest } from './tool-input-digest'
import {
  captureObservedToolOutcome,
  withObservedToolOutcomes,
  type AuthenticatedToolDenial,
  type ObservedToolOutcome,
} from './tool-outcome-persistence'
import { stripTextualToolCalls } from './textual-tool-calls'
import { HarnessWaitRollover } from './waits'
import { buildHarnessRunnerCheckpoint } from './runner-checkpoint'
import {
  handleWaitingState as handleHarnessWaitingState,
  resumePendingApprovals,
  unresolvedApprovalCalls,
} from './runner-waiting'

const DUPLICATE_GUARDED_CREATE_TOOLS = new Set([
  'create_note', 'create_task', 'create_automation', 'create_folder', 'create_agent',
])

export type HarnessExecutionInput = {
  instructions: string
  messages: ModelMessage[]
  model: HarnessModelReference
  tools: ToolSet
  settings?: HarnessModelSettings
  writable?: WritableStream<ModelCallStreamPart<ToolSet>>
  continuation?: HarnessRunnerCheckpoint
}

export type HarnessExecutionResult = {
  outcome: 'finished' | 'blocked' | 'already_running' | 'continued'
  snapshot: HarnessSnapshot
  messages: ModelMessage[]
  steps: StepResult<ToolSet>[]
}

function isTerminal(state: HarnessSnapshot) {
  return ['completed', 'failed', 'cancelled'].includes(state.status)
}

function onlyChildrenRemain(state: HarnessSnapshot) {
  return state.children.some(child => child.status === 'running') && !hasRunnableHarnessMilestones(state)
}

type HarnessWaitingOutcome =
  | { kind: 'blocked'; snapshot: HarnessSnapshot }
  | { kind: 'restart'; messages: ModelMessage[]; invocation: number; resetStagnation: boolean }

async function processHarnessWait(input: {
  state: HarnessSnapshot
  messages: ModelMessage[]
  ports: HarnessExecutionPorts
  invocation: number
  pendingApproval: { requests: HarnessApprovalRequest[]; segment: number } | undefined
  tools: ToolSet
  approvals: HarnessToolApprovals
  authenticatedDenials: Map<string, AuthenticatedToolDenial>
}): Promise<HarnessWaitingOutcome | { kind: 'handoff' } | null> {
  try {
    if (input.pendingApproval) {
      const approval = await resumePendingApprovals(input.pendingApproval.requests, input.tools, input.messages,
        input.ports, input.pendingApproval.segment, input.approvals, input.authenticatedDenials)
      if (approval.kind === 'blocked') return approval
      return { kind: 'restart', messages: approval.messages, invocation: input.invocation, resetStagnation: approval.resetStagnation }
    }
    return await handleHarnessWaitingState(input.state, input.messages, input.ports, input.invocation)
  } catch (error) {
    if (error instanceof HarnessWaitRollover && input.state.policy.executionPolicyVersion === 2) return { kind: 'handoff' }
    throw error
  }
}

function segmentLimitReached(
  state: HarnessSnapshot,
  modelCall: number,
  segmentModelCallStart: number,
  segmentStartedAt: number,
): boolean {
  return state.policy.executionPolicyVersion === 2 && state.status !== 'waiting_for_authorization'
    && (modelCall - segmentModelCallStart >= 32 || Date.now() - segmentStartedAt >= 60 * 60_000)
}

function confirmedModelPause(
  state: HarnessSnapshot,
  receiptId: string,
  executionOwner: string,
  executionGeneration: number,
): boolean {
  const ownerMatches = state.workflowRunId === executionOwner
    && (state.executionGeneration ?? 0) === executionGeneration
  return ownerMatches && (
    (state.status === 'waiting_for_resources'
      && state.resourcePause?.receiptId === receiptId
      && state.latestReceipt?.id === receiptId)
    || (receiptId.startsWith('model:')
      && state.status === 'waiting_for_input' && state.blocker?.kind === 'budget')
  )
}

function activeModelTools(
  current: HarnessSnapshot,
  preparedActiveToolNames: string[],
  tools: ToolSet,
  controls: Set<string>,
  complete: boolean,
  needsPlan: boolean,
): string[] {
  const allowed = new Set(preparedActiveToolNames)
  return Object.keys(tools).filter(name => complete
    ? hasPendingHarnessAnswer(current) && controls.has(name)
    : needsPlan
      ? name === 'harness_set_plan'
      : controls.has(name) || (current.policy.allowedToolIds.includes(name) && allowed.has(name)))
}

function assertPreparedModelAuthority(
  prepared: Awaited<ReturnType<HarnessExecutionPorts['prepareModel']>>,
  credentialOwnerId: string,
): void {
  if (!Number.isSafeInteger(prepared.estimatedCostMicros) || prepared.estimatedCostMicros < 0) {
    throw new Error('Invalid model cost reservation.')
  }
  if (prepared.model && prepared.model.credentialOwnerId !== credentialOwnerId) {
    throw new Error('Model routing cannot change the credential owner.')
  }
}

async function acquireHarnessExecution(
  ports: HarnessExecutionPorts,
  messages: ModelMessage[],
  deliverySteps: StepResult<ToolSet>[],
  executionOutcomes: Map<string, ObservedToolOutcome>,
  authenticatedDenials: Map<string, AuthenticatedToolDenial>,
): Promise<
  | { outcome: HarnessExecutionResult }
  | { initial: HarnessSnapshot; executionOwner: string; executionGeneration: number }
> {
  const initial = await ports.read()
  if (isTerminal(initial)) {
    return { outcome: withObservedToolOutcomes({ outcome: 'finished', snapshot: initial, messages, steps: deliverySteps }, executionOutcomes, authenticatedDenials) }
  }
  if (!await ports.claim()) {
    return { outcome: withObservedToolOutcomes({ outcome: 'already_running', snapshot: await ports.read(), messages, steps: deliverySteps }, executionOutcomes, authenticatedDenials) }
  }
  const claimedState = await ports.read()
  const executionOwner = claimedState.workflowRunId
  if (!executionOwner) throw new Error('Harness execution has no current workflow owner.')
  return { initial, executionOwner, executionGeneration: claimedState.executionGeneration ?? 0 }
}

async function shouldRecoverModelInvocation(
  recovered: boolean,
  lastStep: StepResult<ToolSet> | undefined,
  receiptId: string,
  ports: HarnessExecutionPorts,
): Promise<boolean> {
  if (recovered) return true
  if (!lastStep || !harnessModelResponseFailure(lastStep)) return false
  return await ports.recoverModelFailure?.(receiptId) ?? false
}

function duplicateCreateEvidence(state: HarnessSnapshot, name: string, input: unknown): HarnessSnapshot['evidence'][number] | undefined {
  if (!DUPLICATE_GUARDED_CREATE_TOOLS.has(name)) return undefined
  const inputDigest = harnessToolInputDigest(name, input)
  return state.evidence.find(evidence => evidence.kind === 'tool_result'
    && evidence.verdict !== 'failed' && evidence.source === name && evidence.inputDigest === inputDigest)
}

function wrapAuthorizedTools(
  surfaceTools: ToolSet,
  ports: HarnessExecutionPorts,
  controls: Set<string>,
  approvals: HarnessToolApprovals,
): ToolSet {
  const definitions = { ...surfaceTools, ...createHarnessControlTools(ports) }
  let toolTail: Promise<unknown> = Promise.resolve()
  return Object.fromEntries(Object.entries(definitions).sort(([a], [b]) => a.localeCompare(b)).map(([name, definition]) => {
    const execute = definition.execute
    return [name, !execute ? definition : {
      ...definition,
      execute: (value: unknown, options: Parameters<NonNullable<typeof execute>>[1]) => {
        const pending = toolTail.then(async () => {
          let state = await ports.read()
          if (state.policy.executionPolicyVersion === 2) {
            await ports.renewLease()
            state = await ports.read()
          }
          assertHarnessRunnable(state, Date.now())
          if (!controls.has(name)) {
            if (!state.policy.allowedToolIds.includes(name)) throw new Error('This tool is not authorized for this run.')
            if (state.policy.requiresPlan && !state.plan.length) throw new Error('Create the required plan before executing work.')
            await ports.authorizeTool(name)
          }
          const duplicate = duplicateCreateEvidence(state, name, value)
          if (duplicate) {
            return {
              success: false,
              error: `Duplicate: this exact ${name} call already succeeded as evidence ${duplicate.id}. Cite that evidence instead of repeating it.`,
            }
          }
          const invoke = execute as (
            input: unknown,
            options: HarnessToolExecutionOptions,
          ) => unknown
          return invoke(value, { ...options, harnessApproved: approvals.consume(name, options.toolCallId, value) })
        })
        toolTail = pending.then(() => undefined, () => undefined)
        return pending
      },
    }]
  }))
}

const STAGNATION_RECOVERY_START = 2
const STAGNATION_PAUSE_AFTER = 6

type InvocationContinuation =
  | { kind: 'finished'; snapshot: HarnessSnapshot }
  | { kind: 'continue'; stagnantSegments: number; finalAnswerRequired: boolean }

async function finishOrCheckpointInvocation(
  state: HarnessSnapshot,
  ports: HarnessExecutionPorts,
  segment: number,
  before: string,
  runSteps: StepResult<ToolSet>[],
  toolNames: ReadonlySet<string>,
  truncatedResponse: boolean,
  stagnantSegments: number,
): Promise<InvocationContinuation> {
  if (onlyChildrenRemain(state)) {
    await ports.apply(`wait-children:${segment}`, { type: 'wait_for_children' })
    return { kind: 'continue', stagnantSegments, finalAnswerRequired: false }
  }
  const completionIssues = harnessCompletionIssues(state)
  const resultSummary = latestFinalAnswerText(runSteps, toolNames)
  const finalAnswerRequired = !truncatedResponse && !completionIssues.length && !resultSummary
  if (!truncatedResponse && !completionIssues.length && resultSummary) {
    const completed = await ports.apply(`finish:${segment}`, {
      type: 'finish', ...(resultSummary ? { resultSummary: resultSummary.slice(0, 8_000) } : {}),
    })
    return { kind: 'finished', snapshot: completed }
  }
  const nextStagnantSegments = harnessProgressFingerprint(state) === before ? stagnantSegments + 1 : 0
  if (nextStagnantSegments >= STAGNATION_PAUSE_AFTER) {
    await ports.apply(`stuck:${segment}`, {
      type: 'block',
      blocker: { kind: 'stuck', question: buildHarnessStuckQuestion(state, STAGNATION_PAUSE_AFTER) },
    })
    return { kind: 'continue', stagnantSegments: nextStagnantSegments, finalAnswerRequired }
  }
  const summary = stripTextualToolCalls(state.workingSummary, toolNames)
    || latestCheckpointSummaryText(runSteps, toolNames)
  await ports.apply(`checkpoint:${segment}`, { type: 'checkpoint', summary: summary.slice(0, 8_000), purpose: 'continuation' })
  return { kind: 'continue', stagnantSegments: nextStagnantSegments, finalAnswerRequired }
}

function latestFinalAnswerText(steps: StepResult<ToolSet>[], toolNames: ReadonlySet<string>): string {
  for (let index = steps.length - 1; index >= 0; index--) {
    const step = steps[index]
    if (step.toolCalls.length) break
    const text = stripTextualToolCalls(step.text ?? '', toolNames)
    if (text) return text
  }
  return ''
}

function latestCheckpointSummaryText(steps: StepResult<ToolSet>[], toolNames: ReadonlySet<string>): string {
  for (let index = steps.length - 1; index >= 0; index--) {
    const text = stripTextualToolCalls(steps[index]?.text ?? '', toolNames)
    if (text) return text
  }
  return ''
}

async function authorizeModelBoundary(
  state: HarnessSnapshot,
  ports: HarnessExecutionPorts,
  operationId: string,
  estimatedCostMicros = 0,
): Promise<HarnessSnapshot> {
  if (state.policy.executionPolicyVersion === 2) {
    await ports.renewLease()
    state = await ports.read()
  }
  if (state.policy.resourcePauseVersion === 1) {
    if (!ports.waitForResources) throw new Error('This workflow does not support resource waits.')
    state = await ports.waitForResources(estimatedCostMicros)
  } else if (state.status === 'running') {
    try {
      assertHarnessRunnable(state, Date.now(), estimatedCostMicros)
    } catch (error) {
      if (!(error instanceof HarnessBudgetExceededError)) throw error
      await ports.apply(operationId, {
        type: 'block', blocker: { kind: 'budget', question: 'This legacy task reached its authorized spending limit. Progress is saved; review the partial result before authorizing more work.' },
      })
      throw new HarnessYield(`model:${operationId.split(':').at(-1)}`)
    }
  }
  if (state.status !== 'running') {
    const receiptId = operationId.startsWith('budget:') ? `model:${operationId.split(':').at(-1)}` : state.latestReceipt?.id
    if (receiptId) throw new HarnessYield(receiptId)
    throw new Error('Harness execution is not runnable.')
  }
  return state
}

// Called inside a surface's workflow, never inside a single durable step.
// WorkflowAgent owns model/tool iteration; this controller owns task completion.
export async function runOverlayHarness(input: HarnessExecutionInput, ports: HarnessExecutionPorts): Promise<HarnessExecutionResult> {
  if (input.messages.some(message => message.role === 'system')) throw new Error('Supply trusted system content through harness instructions, not conversation messages.')
  let messages = input.continuation?.messages ?? input.messages
  const steps: StepResult<ToolSet>[] = []
  const deliverySteps: StepResult<ToolSet>[] = [...(input.continuation?.deliverySteps ?? [])]
  const executionOutcomes = new Map<string, ObservedToolOutcome>(input.continuation?.executionOutcomes)
  const authenticatedDenials = new Map<string, AuthenticatedToolDenial>(input.continuation?.authenticatedDenials)
  const controls = new Set<string>(HARNESS_CONTROL_TOOLS)
  const toolNames = new Set([...Object.keys(input.tools), ...HARNESS_CONTROL_TOOLS])
  assertNoControlToolReplacement(input.tools, controls)
  const acquisition = await acquireHarnessExecution(ports, messages, deliverySteps, executionOutcomes, authenticatedDenials)
  if ('outcome' in acquisition) return acquisition.outcome
  let observedState = acquisition.initial
  const { executionOwner, executionGeneration } = acquisition
  const approvals = createHarnessToolApprovals(input.continuation?.toolApprovals)
  const tools = wrapAuthorizedTools(input.tools, ports, controls, approvals)
  const toolDefinitions = await prepareToolDefinitions(tools)
  const instructions = buildHarnessInstructions(input.instructions)
  let truncatedResponse = input.continuation?.truncatedResponse ?? false
  let finalAnswerRequired = input.continuation?.finalAnswerRequired ?? false
  let invocation = input.continuation?.invocation ?? 0
  let modelCall = input.continuation?.modelCall ?? 0
  let stagnantSegments = input.continuation?.stagnantSegments ?? 0
  const segmentStartedAt = Date.now()
  const segmentModelCallStart = modelCall
  let pendingApproval = input.continuation?.pendingApproval
  const handoff = async (): Promise<HarnessExecutionResult> => {
    const checkpoint = buildHarnessRunnerCheckpoint({
      messages, invocation, modelCall, stagnantSegments, finalAnswerRequired, truncatedResponse,
      segmentStartedAt: Date.now(), deliverySteps, pendingApproval, toolApprovals: approvals.snapshot(),
      executionOutcomes, authenticatedDenials,
    })
    if ((await ports.read()).modelReservation) throw new Error('HARNESS_CONTINUATION_HAS_UNRESOLVED_MODEL_RESERVATION')
    const handedOff = await ports.continueExecution(checkpoint)
    return withObservedToolOutcomes({ outcome: 'continued', snapshot: handedOff, messages, steps: deliverySteps },
      executionOutcomes, authenticatedDenials)
  }

  while (true) {
    const state = await ports.read()
    if (isTerminal(state)) {
      return withObservedToolOutcomes({ outcome: 'finished', snapshot: state, messages, steps: deliverySteps }, executionOutcomes, authenticatedDenials)
    }
    if (segmentLimitReached(state, modelCall, segmentModelCallStart, segmentStartedAt)) return handoff()
    const waiting = await processHarnessWait({
      state, messages, ports, invocation, pendingApproval, tools, approvals, authenticatedDenials,
    })
    if (waiting?.kind === 'handoff') return handoff()
    if (waiting) {
      if (waiting.kind === 'blocked') {
        return withObservedToolOutcomes({ outcome: 'blocked', snapshot: waiting.snapshot, messages, steps: deliverySteps }, executionOutcomes, authenticatedDenials)
      }
      messages = waiting.messages
      invocation = waiting.invocation
      if (waiting.resetStagnation) stagnantSegments = 0
      pendingApproval = undefined
      continue
    }
    const segment = invocation++
    const before = harnessProgressFingerprint(state)
    let previous = before
    let stagnantCalls = 0
    let invocationSteps: StepResult<ToolSet>[] = []
    let invocationMessages = messages
    const settledSteps: StepResult<ToolSet>[] = []
    let recoverySteps: StepResult<ToolSet>[] = []
    let recoveryMessages = messages
    let preparedReceiptId = `model:${modelCall}`
    const recordedSteps = new Set<number>()
    const recordModelStep = async (step: Parameters<HarnessExecutionPorts['recordModelStep']>[0]) => {
      if (recordedSteps.has(step.stepNumber)) return
      await ports.recordModelStep(step, `model:${modelCall}`)
      modelCall++
      recordedSteps.add(step.stepNumber)
      settledSteps.push(step)
    }
    const agent = new WorkflowAgent({
      model: new HarnessLanguageModel(input.model),
      instructions,
      tools,
      ...input.settings,
      maxRetries: 0,
      stopWhen: [isLoopFinished(), () => {
        const progress = harnessProgressFingerprint(observedState)
        stagnantCalls = progress === previous ? stagnantCalls + 1 : 0
        previous = progress
        return observedState.status !== 'running' || onlyChildrenRemain(observedState) || stagnantCalls >= 3
          || (observedState.policy.executionPolicyVersion === 2
            && (modelCall - segmentModelCallStart >= 32 || Date.now() - segmentStartedAt >= 60 * 60 * 1000))
      }],
      prepareStep: async ({ messages: prompt }) => {
        // This boundary includes completed tools, but none of the next call's partial output.
        recoveryMessages = prompt.filter(message => message.role !== 'system')
        recoverySteps = [...settledSteps]
        let current = await authorizeModelBoundary(await ports.read(), ports, `budget:${segment}:${modelCall}`)
        const instructionContext = {
          instructions,
          continuation: segment > 0,
          truncatedResponse,
          finalAnswerRequired,
          ...(stagnantSegments >= STAGNATION_RECOVERY_START
            ? { stagnationRecoveryAttempt: stagnantSegments - STAGNATION_RECOVERY_START + 1 } : {}),
        }
        const receiptId = `model:${modelCall}`
        preparedReceiptId = receiptId
        const prepared = await ports.prepareModel({ receiptId, state: current, messages: prompt, instructionContext,
          toolNames: Object.keys(tools), toolDefinitions, settings: input.settings ?? {} })
        assertPreparedModelAuthority(prepared, input.model.credentialOwnerId)
        current = await authorizeModelBoundary(await ports.read(), ports, `budget:${segment}:${modelCall}`, prepared.estimatedCostMicros)
        const complete = harnessCompletionIssues(current).length === 0 && current.plan.length > 0
        current = await ports.apply(`reserve:${receiptId}`, { type: 'reserve_model', id: receiptId, maxCostMicros: prepared.estimatedCostMicros })
        const needsPlan = current.policy.requiresPlan && !current.plan.length
        observedState = current
        const activeTools = activeModelTools(current, prepared.activeToolNames, tools, controls, complete, needsPlan)
        return {
          system: prepared.instructions ?? buildHarnessStepInstructions(current, instructionContext),
          messages: prepared.messages.filter(message => message.role !== 'system'),
          ...prepared.settings,
          activeTools,
          ...(needsPlan ? { toolChoice: 'required' as const } : {}),
          ...(activeTools.length ? {} : { toolChoice: 'none' as const }),
          ...(prepared.model ? { model: new HarnessLanguageModel(prepared.model) } : {}),
        }
      },
      onStepEnd: recordModelStep,
      onToolExecutionEnd: async event => {
        if (!controls.has(event.toolCall.toolName)) {
          await ports.recordToolResult(event)
          captureObservedToolOutcome(event, executionOutcomes)
        }
        observedState = await ports.read()
      },
      onEnd: async result => {
        // WorkflowAgent returns approval-paused steps before its iterator's
        // onStepEnd callback. Model usage is already known and must settle
        // before suspension or another preparation/compaction reservation.
        for (const step of result.steps) await recordModelStep(step)
        invocationSteps = result.steps
        invocationMessages = result.messages
      },
    })

    let pending: HarnessApprovalRequest[] = []
    const invocationResult = await runHarnessModelInvocation(
      () => agent.stream({ messages, writable: input.writable, preventClose: true, sendFinish: false }),
      () => ({ messages: recoveryMessages, steps: recoverySteps, preparedReceiptId, modelCall }),
      unresolvedApprovalCalls,
      ports.recoverModelFailure,
      async receiptId => {
        const paused = await ports.read()
        return confirmedModelPause(paused, receiptId, executionOwner, executionGeneration)
      },
    )
    invocationMessages = invocationResult.messages
    invocationSteps = invocationResult.steps
    preparedReceiptId = invocationResult.preparedReceiptId
    modelCall = invocationResult.modelCall
    pending = invocationResult.pending
    const lastStep = invocationSteps.at(-1)
    if (await shouldRecoverModelInvocation(invocationResult.recovered, lastStep, preparedReceiptId, ports)) {
      messages = recoveryMessages
      steps.push(...recoverySteps)
      deliverySteps.push(...recoverySteps)
      continue
    }
    // WorkflowAgent returns its system prompt in history. Rebuild it exclusively
    // from trusted instructions and current durable state on every invocation.
    messages = invocationMessages.filter(message => message.role !== 'system')
    steps.push(...invocationSteps)
    deliverySteps.push(...invocationSteps)
    const updatedState = await ports.read()
    const finishReason = invocationSteps.at(-1)?.finishReason
    if (await terminateOnProviderFailure(updatedState, finishReason, ports, segment)) continue
    truncatedResponse = finishReason === 'length'
    if (updatedState.status !== 'running') continue
    if (pending.length) {
      pendingApproval = { requests: pending, segment }
      continue
    }
    const continuation = await finishOrCheckpointInvocation(updatedState, ports, segment, before, steps, toolNames, truncatedResponse, stagnantSegments)
    if (continuation.kind === 'finished') {
      return withObservedToolOutcomes({ outcome: 'finished', snapshot: continuation.snapshot, messages, steps: deliverySteps }, executionOutcomes, authenticatedDenials)
    }
    stagnantSegments = continuation.stagnantSegments
    finalAnswerRequired = continuation.finalAnswerRequired
  }
}
