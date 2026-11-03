import {
  WorkflowAgent,
  type ModelCallStreamPart,
  type WorkflowAgentStreamResult,
} from '@ai-sdk/workflow'
import { isLoopFinished, type ModelMessage, type StepResult, type ToolSet } from 'ai'
import { sleep } from 'workflow'
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
  HARNESS_CONTROL_TOOLS, harnessProgressFingerprint,
} from './context'
import type { HarnessApprovalRequest, HarnessExecutionPorts, HarnessModelSettings, HarnessRunnerCheckpoint } from './ports'
import { HarnessLanguageModel, type HarnessModelReference } from './secure-model'
import { createHarnessToolApprovals, type HarnessToolApprovals, type HarnessToolExecutionOptions } from './tool-approvals'
import { assertNoControlToolReplacement, prepareToolDefinitions } from './tool-definitions'
import { harnessModelResponseFailure } from './model-usage'
import { HarnessYield, runHarnessModelInvocation, terminateOnProviderFailure } from './model-recovery'
import { harnessToolInputDigest } from './tool-input-digest'
import {
  captureAuthenticatedToolDenials,
  captureObservedToolOutcome,
  withObservedToolOutcomes,
  type AuthenticatedToolDenial,
  type ObservedToolOutcome,
} from './tool-outcome-persistence'
import { stripTextualToolCalls } from './textual-tool-calls'

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

type WaitingStateOutcome =
  | { kind: 'blocked'; snapshot: HarnessSnapshot }
  | { kind: 'restart'; messages: ModelMessage[]; invocation: number; resetStagnation: boolean }

type HarnessApprovalDecision = NonNullable<Awaited<ReturnType<HarnessExecutionPorts['waitForApproval']>>>[number]
type ApprovalResumeOutcome =
  | { kind: 'blocked'; snapshot: HarnessSnapshot }
  | { kind: 'restart'; messages: ModelMessage[]; resetStagnation: boolean }

const STAGNATION_RECOVERY_START = 2
const STAGNATION_PAUSE_AFTER = 6

async function handleWaitingState(
  state: HarnessSnapshot,
  messages: ModelMessage[],
  ports: HarnessExecutionPorts,
  invocation: number,
): Promise<WaitingStateOutcome | null> {
  if (state.status === 'waiting_for_resources' && state.resourcePause) {
    if (state.policy.executionPolicyVersion !== 2 || state.policy.spendingMode !== 'workspace') {
      return { kind: 'blocked', snapshot: state }
    }
    if (ports.waitForFunding) await ports.waitForFunding()
    else await sleep('60s')
    const current = await ports.read()
    if (isTerminal(current) || current.status !== 'waiting_for_resources' || !current.resourcePause) {
      return { kind: 'restart', messages, invocation, resetStagnation: false }
    }
    if (!ports.checkFunding || !await ports.checkFunding(current.resourcePause.requiredCents)) {
      return { kind: 'restart', messages, invocation, resetStagnation: false }
    }
    await ports.renewLease()
    await ports.apply(`resume-funding:${current.resourcePause.receiptId}`, { type: 'resume_funding' })
    return { kind: 'restart', messages, invocation, resetStagnation: false }
  }
  if (state.status === 'waiting_for_resources' && state.policy.resourcePauseVersion === 1 && ports.waitForResources) {
    await ports.waitForResources(0)
    return { kind: 'restart', messages, invocation, resetStagnation: false }
  }
  if (state.status === 'waiting_for_children') {
    await ports.waitForChildren(state.children.filter(child => child.status === 'running').map(child => child.id))
    const current = await ports.read()
    if (!isTerminal(current)) await ports.apply(`resume-children:${invocation}`, { type: 'resume' })
    return { kind: 'restart', messages, invocation: invocation + (isTerminal(current) ? 0 : 1), resetStagnation: false }
  }
  if (state.status === 'running') return null
  if (state.blocker?.kind !== 'input' && state.blocker?.kind !== 'stuck') return { kind: 'blocked', snapshot: state }
  const reply = await ports.waitForInput(state)
  if (!reply) return { kind: 'blocked', snapshot: await ports.read() }
  const current = await ports.read()
  if (isTerminal(current)) return { kind: 'restart', messages, invocation, resetStagnation: false }
  await ports.apply(`resume-input:${invocation}`, { type: 'resume' })
  return {
    kind: 'restart',
    messages: [...messages, ...reply],
    invocation: invocation + 1,
    resetStagnation: true,
  }
}

function assertPendingApprovalsExecutable(pending: HarnessApprovalRequest[], tools: ToolSet): void {
  if (pending.some(request => !tools[request.toolName]?.execute || !tools[request.toolName]?.needsApproval)) {
    throw new Error('A tool returned without an executor or a supported approval policy.')
  }
}

function isInvalidApprovalCall(result: WorkflowAgentStreamResult<ToolSet>, callId: string): boolean {
  const lastStepCall = result.steps.at(-1)?.toolCalls.find(call => call.toolCallId === callId)
  if ((lastStepCall as typeof lastStepCall & { invalid?: boolean })?.invalid === true) return true
  let assistantCallIndex = -1
  for (let index = result.messages.length - 1; index >= 0; index--) {
    const message = result.messages[index]
    const hasCall = message?.role === 'assistant' && Array.isArray(message.content)
      && message.content.some((part: unknown) => typeof part === 'object' && part !== null
        && 'type' in part && part.type === 'tool-call'
        && 'toolCallId' in part && part.toolCallId === callId)
    if (hasCall) {
      assistantCallIndex = index
      break
    }
  }
  return assistantCallIndex >= 0 && result.messages.slice(assistantCallIndex + 1).some(message => (
    message.role === 'tool' && message.content.some(part =>
      part.type === 'tool-result' && part.toolCallId === callId && part.output.type === 'error-text')
  ))
}

function unresolvedApprovalCalls(result: WorkflowAgentStreamResult<ToolSet>): HarnessApprovalRequest[] {
  const lastStep = result.steps.at(-1)
  const lastStepContent = lastStep?.content ?? []
  return result.toolCalls
    .filter(call => (call as typeof call & { invalid?: boolean }).invalid !== true
      && !isInvalidApprovalCall(result, call.toolCallId)
      && !result.toolResults.some(toolResult => toolResult.toolCallId === call.toolCallId)
      && !lastStepContent.some(part => part.type === 'tool-error' && part.toolCallId === call.toolCallId))
    .map(call => ({
      approvalId: `approval-${call.toolCallId}`,
      toolCallId: call.toolCallId,
      toolName: call.toolName,
      input: call.input,
    }))
}

function assertApprovalDecisions(pending: HarnessApprovalRequest[], decisions: HarnessApprovalDecision[]): void {
  if (decisions.length !== pending.length || new Set(decisions.map(item => item.approvalId)).size !== pending.length
    || pending.some(request => !decisions.some(decision => decision.approvalId === request.approvalId))) {
    throw new Error('Every pending approval needs exactly one authenticated decision.')
  }
}

function appendApprovalMessages(
  messages: ModelMessage[],
  pending: HarnessApprovalRequest[],
  decisions: HarnessApprovalDecision[],
): ModelMessage[] {
  return [...messages,
    { role: 'assistant', content: pending.map(request => ({ type: 'tool-approval-request', approvalId: request.approvalId, toolCallId: request.toolCallId })) },
    { role: 'tool', content: decisions.map(decision => ({ type: 'tool-approval-response', ...decision })) },
  ]
}

async function resumePendingApprovals(
  pending: HarnessApprovalRequest[],
  tools: ToolSet,
  messages: ModelMessage[],
  ports: HarnessExecutionPorts,
  segment: number,
  approvals: HarnessToolApprovals,
  authenticatedDenials: Map<string, AuthenticatedToolDenial>,
): Promise<ApprovalResumeOutcome> {
  assertPendingApprovalsExecutable(pending, tools)
  await ports.apply(`approval:${segment}`, { type: 'block', blocker: { kind: 'approval', question: 'Approval is required before executing these actions.' } })
  const decisions = await ports.waitForApproval(pending)
  if (!decisions) return { kind: 'blocked', snapshot: await ports.read() }
  const state = await ports.read()
  if (isTerminal(state)) return { kind: 'restart', messages, resetStagnation: false }
  assertApprovalDecisions(pending, decisions)
  captureAuthenticatedToolDenials(pending, decisions, authenticatedDenials)
  const resumedMessages = appendApprovalMessages(messages, pending, decisions)
  await ports.apply(`resume-approval:${segment}`, { type: 'resume' })
  approvals.record(pending, decisions)
  return { kind: 'restart', messages: resumedMessages, resetStagnation: true }
}

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
        type: 'block', blocker: { kind: 'budget', question: 'The authorized time or spending budget is exhausted. Review the partial result before starting more work.' },
      })
      throw new HarnessYield()
    }
  }
  if (state.status !== 'running') throw new HarnessYield()
  return state
}

// Called inside a surface's workflow, never inside a single durable step.
// WorkflowAgent owns model/tool iteration; this controller owns task completion.
export async function runOverlayHarness(input: HarnessExecutionInput, ports: HarnessExecutionPorts): Promise<HarnessExecutionResult> {
  if (input.messages.some(message => message.role === 'system')) throw new Error('Supply trusted system content through harness instructions, not conversation messages.')
  let messages = input.continuation?.messages ?? input.messages
  const steps: StepResult<ToolSet>[] = []
  const deliverySteps: StepResult<ToolSet>[] = [...(input.continuation?.deliverySteps ?? [])]
  const executionOutcomes = new Map<string, ObservedToolOutcome>()
  const authenticatedDenials = new Map<string, AuthenticatedToolDenial>()
  const controls = new Set<string>(HARNESS_CONTROL_TOOLS)
  const toolNames = new Set([...Object.keys(input.tools), ...HARNESS_CONTROL_TOOLS])
  assertNoControlToolReplacement(input.tools, controls)
  const initial = await ports.read()
  let observedState = initial
  if (isTerminal(initial)) {
    return withObservedToolOutcomes({ outcome: 'finished', snapshot: initial, messages, steps: deliverySteps }, executionOutcomes, authenticatedDenials)
  }
  if (!await ports.claim()) {
    return withObservedToolOutcomes({ outcome: 'already_running', snapshot: await ports.read(), messages, steps: deliverySteps }, executionOutcomes, authenticatedDenials)
  }
  const approvals = createHarnessToolApprovals()
  const tools = wrapAuthorizedTools(input.tools, ports, controls, approvals)
  const toolDefinitions = await prepareToolDefinitions(tools)
  const instructions = buildHarnessInstructions(input.instructions)
  let truncatedResponse = input.continuation?.truncatedResponse ?? false
  let finalAnswerRequired = input.continuation?.finalAnswerRequired ?? false
  let invocation = input.continuation?.invocation ?? 0
  let modelCall = input.continuation?.modelCall ?? 0
  let stagnantSegments = input.continuation?.stagnantSegments ?? 0
  const segmentStartedAt = input.continuation?.segmentStartedAt ?? Date.now()
  const segmentModelCallStart = modelCall

  while (true) {
    const state = await ports.read()
    if (isTerminal(state)) {
      return withObservedToolOutcomes({ outcome: 'finished', snapshot: state, messages, steps: deliverySteps }, executionOutcomes, authenticatedDenials)
    }
    const waiting = await handleWaitingState(state, messages, ports, invocation)
    if (waiting) {
      if (waiting.kind === 'blocked') {
        return withObservedToolOutcomes({ outcome: 'blocked', snapshot: waiting.snapshot, messages, steps: deliverySteps }, executionOutcomes, authenticatedDenials)
      }
      messages = waiting.messages
      invocation = waiting.invocation
      if (waiting.resetStagnation) stagnantSegments = 0
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
          || modelCall - segmentModelCallStart >= 32 || Date.now() - segmentStartedAt >= 60 * 60 * 1000
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
        if (!Number.isSafeInteger(prepared.estimatedCostMicros) || prepared.estimatedCostMicros < 0) throw new Error('Invalid model cost reservation.')
        if (prepared.model && prepared.model.credentialOwnerId !== input.model.credentialOwnerId) throw new Error('Model routing cannot change the credential owner.')
        current = await authorizeModelBoundary(await ports.read(), ports, `budget:${segment}:${modelCall}`, prepared.estimatedCostMicros)
        const complete = harnessCompletionIssues(current).length === 0 && current.plan.length > 0
        current = await ports.apply(`reserve:${receiptId}`, { type: 'reserve_model', id: receiptId, maxCostMicros: prepared.estimatedCostMicros })
        const needsPlan = current.policy.requiresPlan && !current.plan.length
        observedState = current
        const allowed = new Set(prepared.activeToolNames)
        const activeTools = Object.keys(tools).filter(name => !complete && (needsPlan
          ? name === 'harness_set_plan'
          : controls.has(name) || (current.policy.allowedToolIds.includes(name) && allowed.has(name))))
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
    let recoveredModel = false
    const invocationResult = await runHarnessModelInvocation(
      () => agent.stream({ messages, writable: input.writable, preventClose: true, sendFinish: false }),
      () => ({ messages: invocationMessages, steps: invocationSteps, preparedReceiptId, modelCall }),
      unresolvedApprovalCalls,
      ports.recoverModelFailure,
    )
    invocationMessages = invocationResult.messages
    invocationSteps = invocationResult.steps
    preparedReceiptId = invocationResult.preparedReceiptId
    modelCall = invocationResult.modelCall
    pending = invocationResult.pending
    recoveredModel = invocationResult.recovered
    const lastStep = invocationSteps.at(-1)
    if (!recoveredModel && lastStep && harnessModelResponseFailure(lastStep)) {
      recoveredModel = await ports.recoverModelFailure?.(preparedReceiptId) ?? false
    }
    if (recoveredModel) {
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
      const approval = await resumePendingApprovals(pending, tools, messages, ports, segment, approvals, authenticatedDenials)
      if (approval.kind === 'blocked') {
        return withObservedToolOutcomes({ outcome: 'blocked', snapshot: approval.snapshot, messages, steps: deliverySteps }, executionOutcomes, authenticatedDenials)
      }
      messages = approval.messages
      if (approval.resetStagnation) stagnantSegments = 0
      continue
    }
    const continuation = await finishOrCheckpointInvocation(updatedState, ports, segment, before, steps, toolNames, truncatedResponse, stagnantSegments)
    if (continuation.kind === 'finished') {
      return withObservedToolOutcomes({ outcome: 'finished', snapshot: continuation.snapshot, messages, steps: deliverySteps }, executionOutcomes, authenticatedDenials)
    }
    stagnantSegments = continuation.stagnantSegments
    finalAnswerRequired = continuation.finalAnswerRequired
    if (modelCall - segmentModelCallStart >= 32 || Date.now() - segmentStartedAt >= 60 * 60 * 1000) {
      const checkpoint: HarnessRunnerCheckpoint = {
        version: 1, messages, invocation, modelCall, stagnantSegments,
        finalAnswerRequired, truncatedResponse, segmentStartedAt: Date.now(), deliverySteps,
      }
      if ((await ports.read()).modelReservation) throw new Error('HARNESS_CONTINUATION_HAS_UNRESOLVED_MODEL_RESERVATION')
      const handedOff = await ports.continueExecution(checkpoint)
      return withObservedToolOutcomes({ outcome: 'continued', snapshot: handedOff, messages, steps: deliverySteps },
        executionOutcomes, authenticatedDenials)
    }
  }
}
