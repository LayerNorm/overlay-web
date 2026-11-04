import { createHarnessDiagnostic, stableHarnessDiagnosticId } from '@overlay/agent-runtime/harness-diagnostic'
import { HARNESS_SILENT_TOOL_BATCHES } from './public-progress'
import {
  WorkflowAgent,
  type ModelCallStreamPart,
} from '@ai-sdk/workflow'
import { isLoopFinished, type ModelMessage, type StepResult, type ToolSet } from 'ai'
import {
  assertHarnessRunnable,
  HarnessBudgetExceededError,
  HarnessDeadlineExceededError,
  harnessCompletionIssues,
  hasRunnableHarnessMilestones,
  type HarnessSnapshot,
} from '@overlay/agent-runtime/harness-state'
import { createHarnessAuthorizedTools } from './authorized-tools'
import {
  buildHarnessInstructions, buildHarnessStepInstructions, buildHarnessStuckQuestion,
  HARNESS_CONTROL_TOOLS, harnessProgressFingerprint, hasPendingHarnessAnswer,
} from './context'
import { buildHarnessCheckpoint } from './continuity'
import { verifyHarnessFinalAnswer } from './final-answer-verification'
import type { HarnessApprovalRequest, HarnessExecutionPorts, HarnessModelSettings, HarnessRunnerCheckpoint } from './ports'
import { HarnessLanguageModel, type HarnessModelReference } from './secure-model'
import type { HarnessToolApprovals } from './tool-approvals'
import { assertNoControlToolReplacement, prepareToolDefinitions } from './tool-definitions'
import { harnessModelResponseFailure } from './model-usage'
import { HarnessYield, runHarnessModelInvocation, terminateOnProviderFailure } from './model-recovery'
import {
  captureObservedToolOutcome,
  withObservedToolOutcomes,
  type AuthenticatedToolDenial,
  type ObservedToolOutcome,
} from './tool-outcome-persistence'
import { hasTextualToolCalls, stripTextualToolCalls, TEXTUAL_TOOL_CALL_MARKERS } from './textual-tool-calls'
import { HarnessWaitRollover } from './waits'
import { buildHarnessRunnerCheckpoint } from './runner-checkpoint'
import {
  handleWaitingState as handleHarnessWaitingState,
  resumePendingApprovals,
  unresolvedApprovalCalls,
} from './runner-waiting'

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
  stepReceiptIds?: Array<string | undefined>
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
    ? (hasPendingHarnessAnswer(current) || current.finalVerification?.supported === false) && controls.has(name)
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
    const observedToolEvidence = state.evidence.filter(evidence => evidence.kind === 'tool_result')
    if (observedToolEvidence.length && ports.verifyFinalAnswer) {
      const verification = await verifyHarnessFinalAnswer({ state, candidate: resultSummary, segment, ports })
      if (verification.kind === 'continue') {
        if (verification.action === 'none') {
          return { kind: 'continue', stagnantSegments, finalAnswerRequired: true }
        }
        if (verification.action === 'checkpoint') {
          await ports.apply(`checkpoint:${segment}:verification`, {
            type: 'checkpoint',
            summary: JSON.stringify(buildHarnessCheckpoint(verification.state)),
            purpose: 'continuation',
            unverifiedNarrative: resultSummary.slice(0, 8_000),
          })
          return { kind: 'continue', stagnantSegments, finalAnswerRequired: true }
        }
        if (verification.action === 'pending') {
          await ports.apply(`verification-pending:${segment}`, {
            type: 'block',
            blocker: { kind: 'stuck', question: verification.question! },
          })
          return { kind: 'continue', stagnantSegments, finalAnswerRequired: true }
        }
        await ports.apply(`verify-block:${segment}`, {
          type: 'block',
          blocker: { kind: 'stuck', question: verification.question! },
        })
        return { kind: 'continue', stagnantSegments, finalAnswerRequired: true }
      }
      state = verification.state
    }
    const completed = await ports.apply(`finish:${segment}`, {
      type: 'finish', ...(resultSummary ? { resultSummary: resultSummary.slice(0, 8_000) } : {}),
    })
    return { kind: 'finished', snapshot: completed }
  }
  const nextStagnantSegments = harnessProgressFingerprint(state) === before ? stagnantSegments + 1 : 0
  if (nextStagnantSegments >= STAGNATION_PAUSE_AFTER) {
    const operationId = `stuck:${segment}`
    await ports.apply(`stuck:${segment}`, {
      type: 'block',
      blocker: { kind: 'stuck', question: buildHarnessStuckQuestion(state, STAGNATION_PAUSE_AFTER) },
      diagnostic: createHarnessDiagnostic({
        diagnosticId: stableHarnessDiagnosticId(state.runId, operationId, state.revision),
        code: 'STAGNATION',
        stage: 'model',
        operationId,
        occurredAt: Date.now(),
      }),
    })
    return { kind: 'continue', stagnantSegments: nextStagnantSegments, finalAnswerRequired }
  }
  await ports.apply(`checkpoint:${segment}`, {
    type: 'checkpoint',
    summary: JSON.stringify(buildHarnessCheckpoint(state)),
    purpose: 'continuation',
    unverifiedNarrative: latestCheckpointSummaryText(runSteps, toolNames).slice(0, 8_000),
  })
  return { kind: 'continue', stagnantSegments: nextStagnantSegments, finalAnswerRequired }
}

function latestFinalAnswerText(
  steps: StepResult<ToolSet>[],
  toolNames: ReadonlySet<string>,
): string {
  for (let index = steps.length - 1; index >= 0; index--) {
    const step = steps[index]
    if (step.toolCalls.length) break
    if (TEXTUAL_TOOL_CALL_MARKERS.some(marker => step.text?.includes(marker))) return ''
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
      if (!(error instanceof HarnessBudgetExceededError) && !(error instanceof HarnessDeadlineExceededError)) throw error
      const diagnostic = createHarnessDiagnostic({
        diagnosticId: stableHarnessDiagnosticId(state.runId, operationId, state.revision),
        code: error instanceof HarnessDeadlineExceededError ? 'TASK_DEADLINE' : 'TASK_SPEND_LIMIT',
        stage: 'model', operationId, occurredAt: Date.now(),
      })
      await ports.apply(operationId, {
        type: 'block', blocker: { kind: 'budget', question: error instanceof HarnessDeadlineExceededError
          ? 'This task reached its authorized run deadline. Review the saved work before starting another task.'
          : 'This task reached its per-task limit, not your workspace credit balance. Review the saved work before increasing the limit.' },
        diagnostic,
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
  const stepReceiptIds: Array<string | undefined> = input.continuation?.stepReceiptIds ?? Array(input.continuation?.deliverySteps?.length ?? 0).fill(undefined)
  const receiptIdsByStep = new WeakMap<StepResult<ToolSet>, string>()
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
  const publicProgressEnabled = acquisition.initial.policy.publicProgressVersion === 1
  let publicProgressDue = publicProgressEnabled && (input.continuation?.publicProgress?.due ?? !input.continuation)
  let publicProgressActive = false
  let silentToolBatches = input.continuation?.publicProgress?.silentToolBatches ?? 0
  let uncertainToolOutcome: Error | undefined
  const { tools, approvals } = createHarnessAuthorizedTools(input.tools, ports, controls, input.continuation?.toolApprovals, {
    publicProgress: () => publicProgressActive, uncertain: error => { uncertainToolOutcome ??= error },
  })
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
      executionOutcomes, authenticatedDenials, stepReceiptIds, publicProgress: { due: publicProgressDue, silentToolBatches },
    })
    if ((await ports.read()).modelReservation) throw new Error('HARNESS_CONTINUATION_HAS_UNRESOLVED_MODEL_RESERVATION')
    const handedOff = await ports.continueExecution(checkpoint)
    return withObservedToolOutcomes({ outcome: 'continued', snapshot: handedOff, messages, steps: deliverySteps, stepReceiptIds },
      executionOutcomes, authenticatedDenials)
  }

  while (true) {
    const state = await ports.read()
    if (isTerminal(state)) {
      return withObservedToolOutcomes({ outcome: 'finished', snapshot: state, messages, steps: deliverySteps, stepReceiptIds }, executionOutcomes, authenticatedDenials)
    }
    if (segmentLimitReached(state, modelCall, segmentModelCallStart, segmentStartedAt)) return handoff()
    const waiting = await processHarnessWait({
      state, messages, ports, invocation, pendingApproval, tools, approvals, authenticatedDenials,
    })
    if (waiting?.kind === 'handoff') return handoff()
    if (waiting) {
      if (waiting.kind === 'blocked') {
        return withObservedToolOutcomes({ outcome: 'blocked', snapshot: waiting.snapshot, messages, steps: deliverySteps, stepReceiptIds }, executionOutcomes, authenticatedDenials)
      }
      messages = waiting.messages
      invocation = waiting.invocation
      if (waiting.resetStagnation) stagnantSegments = 0
      pendingApproval = undefined
      continue
    }
    const segment = invocation++
    const commentaryInvocation = publicProgressDue
    if (commentaryInvocation) {
      publicProgressDue = false
      publicProgressActive = true
    }
    let commentaryText = ''
    let commentaryAttemptedTool = false
    let failedToolResultObserved = false
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
    const receiptByStepNumber = new Map<number, string>()
    const recordModelStep = async (step: Parameters<HarnessExecutionPorts['recordModelStep']>[0]) => {
      const receiptId = receiptByStepNumber.get(step.stepNumber) ?? `model:${modelCall++}`
      receiptByStepNumber.set(step.stepNumber, receiptId)
      receiptIdsByStep.set(step as StepResult<ToolSet>, receiptId)
      if (recordedSteps.has(step.stepNumber)) return
      await ports.recordModelStep(step, receiptId)
      recordedSteps.add(step.stepNumber)
      settledSteps.push(step)
    }
    const agent = new WorkflowAgent({
      model: new HarnessLanguageModel(input.model),
      instructions,
      tools,
      ...input.settings,
      maxRetries: 0,
      stopWhen: [isLoopFinished(), ({ steps: currentSteps }) => {
        // The SDK checks stop conditions before onStepEnd updates our counters.
        const currentStep = currentSteps.at(-1)
        if (publicProgressEnabled && !commentaryInvocation && currentStep?.toolCalls.length
          && !stripTextualToolCalls(currentStep.text ?? '', toolNames).trim()
          && silentToolBatches + 1 >= HARNESS_SILENT_TOOL_BATCHES) publicProgressDue = true
        const progress = harnessProgressFingerprint(observedState)
        stagnantCalls = progress === previous ? stagnantCalls + 1 : 0
        previous = progress
        return commentaryInvocation || (publicProgressEnabled && publicProgressDue) || Boolean(uncertainToolOutcome)
          || observedState.status !== 'running' || onlyChildrenRemain(observedState) || stagnantCalls >= 3
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
          publicProgress: commentaryInvocation,
          continuation: segment > 0,
          truncatedResponse,
          finalAnswerRequired: finalAnswerRequired || (current.plan.length > 0 && harnessCompletionIssues(current).length === 0),
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
        const pendingAnswerControls = complete && activeTools.length > 0
        return {
          system: prepared.instructions ?? buildHarnessStepInstructions(current, instructionContext),
          messages: prepared.messages.filter(message => message.role !== 'system'),
          ...prepared.settings,
          activeTools: commentaryInvocation ? [] : activeTools,
          ...(needsPlan && !commentaryInvocation ? { toolChoice: 'required' as const } : {}),
          ...(pendingAnswerControls ? { toolChoice: 'auto' as const } : {}),
          ...(!commentaryInvocation && activeTools.length ? {} : { toolChoice: 'none' as const }),
          ...(prepared.model ? { model: new HarnessLanguageModel(prepared.model) } : {}),
        }
      },
      onStepEnd: async step => {
        if (commentaryInvocation) {
          commentaryText = stripTextualToolCalls(step.text ?? '', toolNames).trim()
          if (step.toolCalls.length || hasTextualToolCalls(step.text ?? '', toolNames)) commentaryAttemptedTool = true
        } else if (publicProgressEnabled) {
          const publicText = stripTextualToolCalls(step.text ?? '', toolNames).trim()
          if (step.toolCalls.length) {
            silentToolBatches = publicText ? 0 : silentToolBatches + 1
            if (!publicText && (failedToolResultObserved || silentToolBatches >= HARNESS_SILENT_TOOL_BATCHES)) {
              publicProgressDue = true
            }
          } else if (publicText) {
            silentToolBatches = 0
          }
        }
        await recordModelStep(step)
      },
      onToolExecutionEnd: async event => {
        if (commentaryInvocation) {
          commentaryAttemptedTool = true
          // No work can execute in this phase. A provider ignoring toolChoice
          // must not create work evidence or enter an approval wait.
          return
        }
        if (!controls.has(event.toolCall.toolName)) {
          await ports.recordToolResult(event)
          captureObservedToolOutcome(event, executionOutcomes)
          const output = event.output as { success?: unknown; isError?: unknown } | undefined
          if (!event.success || event.error !== undefined || output?.success === false || output?.isError === true) {
            failedToolResultObserved = true
            if (publicProgressEnabled) publicProgressDue = true
          }
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
      async () => {
        const blocked = await ports.read()
        return blocked.workflowRunId === executionOwner
          && (blocked.executionGeneration ?? 0) === executionGeneration
          && blocked.status === 'waiting_for_input' && blocked.blocker?.kind === 'stuck'
      },
    )
    invocationMessages = invocationResult.messages
    invocationSteps = invocationResult.steps
    preparedReceiptId = invocationResult.preparedReceiptId
    modelCall = invocationResult.modelCall
    pending = invocationResult.pending
    publicProgressActive = false
    if (uncertainToolOutcome) {
      const failed = await ports.read()
      const operationId = (uncertainToolOutcome as Error & { operationId?: string }).operationId ?? `tool:${segment}`
      const diagnostic = createHarnessDiagnostic({
        diagnosticId: stableHarnessDiagnosticId(failed.runId, operationId, failed.revision),
        code: 'TOOL_OUTCOME_UNKNOWN', stage: 'tool', operationId, occurredAt: Date.now(),
      })
      await ports.apply(`uncertain-tool:${operationId}`, { type: 'terminate', status: 'failed',
        reason: diagnostic.safeMessage, diagnostic })
    }
    const lastStep = invocationSteps.at(-1)
    if (await shouldRecoverModelInvocation(invocationResult.recovered, lastStep, preparedReceiptId, ports)) {
      messages = recoveryMessages
      stepReceiptIds.push(...recoverySteps.map(step => receiptIdsByStep.get(step)))
      steps.push(...recoverySteps)
      deliverySteps.push(...recoverySteps)
      continue
    }
    // WorkflowAgent returns its system prompt in history. Rebuild it exclusively
    // from trusted instructions and current durable state on every invocation.
    messages = invocationMessages.filter(message => message.role !== 'system')
    const publicSteps = commentaryInvocation && commentaryAttemptedTool ? [] : invocationSteps
    stepReceiptIds.push(...publicSteps.map(step => receiptByStepNumber.get(step.stepNumber)))
    steps.push(...publicSteps)
    deliverySteps.push(...publicSteps)
    const updatedState = await ports.read()
    const finishReason = invocationSteps.at(-1)?.finishReason
    if (await terminateOnProviderFailure(updatedState, finishReason, ports, segment)) {
      if (commentaryInvocation) publicProgressDue = true
      continue
    }
    truncatedResponse = finishReason === 'length'
    if (updatedState.status !== 'running') continue
    if (commentaryInvocation) {
      if (commentaryAttemptedTool || !commentaryText) {
        // A presentation-only response cannot abort otherwise valid work.
        // Its known usage is settled; discard malformed model history, and
        // resume the existing task without executing or approving its calls.
        messages = recoveryMessages
      }
      silentToolBatches = 0
      finalAnswerRequired = false
      truncatedResponse = false
      if (messages.at(-1)?.role === 'assistant') {
        messages = [...messages, { role: 'user', content: 'Continue the existing task after the public progress update. Use the current persisted state and evidence; do not repeat completed actions.' }]
      }
      continue
    }
    if (pending.length) {
      pendingApproval = { requests: pending, segment }
      continue
    }
    const continuation = await finishOrCheckpointInvocation(
      updatedState, ports, segment, before, invocationSteps,
      toolNames, truncatedResponse, stagnantSegments,
    )
    if (continuation.kind === 'finished') {
      return withObservedToolOutcomes({ outcome: 'finished', snapshot: continuation.snapshot, messages, steps: deliverySteps, stepReceiptIds }, executionOutcomes, authenticatedDenials)
    }
    stagnantSegments = continuation.stagnantSegments
    finalAnswerRequired = continuation.finalAnswerRequired
    // A continuation is a new turn, not an assistant prefill. Some providers
    // reject assistant-tailed prompts, including after verification feedback.
    if (messages.at(-1)?.role === 'assistant') {
      messages = [...messages, { role: 'user', content: 'Continue the existing task using the current persisted state and verification feedback. Obtain any missing evidence before correcting the answer. Do not repeat completed actions.' }]
    }
  }
}
