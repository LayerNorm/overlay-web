import {
  WorkflowAgent,
  type ModelCallStreamPart,
  type WorkflowAgentStreamResult,
} from '@ai-sdk/workflow'
import { asSchema, isLoopFinished, type ModelMessage, type StepResult, type ToolSet } from 'ai'
import type { LanguageModelV4FunctionTool } from '@ai-sdk/provider'
import {
  assertHarnessRunnable,
  harnessCompletionIssues,
  hasRunnableHarnessMilestones,
  type HarnessSnapshot,
} from '@overlay/agent-runtime/harness-state'
import { createHarnessControlTools } from './control-tools'
import { buildHarnessInstructions, buildHarnessStepInstructions, HARNESS_CONTROL_TOOLS, harnessProgressFingerprint } from './context'
import type { HarnessApprovalRequest, HarnessExecutionPorts, HarnessModelSettings } from './ports'
import { HarnessLanguageModel, type HarnessModelReference } from './secure-model'
import { createHarnessToolApprovals, type HarnessToolApprovals, type HarnessToolExecutionOptions } from './tool-approvals'
import { stripTextualToolCalls } from './textual-tool-calls'

export type HarnessExecutionInput = {
  instructions: string
  messages: ModelMessage[]
  model: HarnessModelReference
  tools: ToolSet
  settings?: HarnessModelSettings
  writable?: WritableStream<ModelCallStreamPart<ToolSet>>
}

export type HarnessExecutionResult = {
  outcome: 'finished' | 'blocked' | 'already_running'
  snapshot: HarnessSnapshot
  messages: ModelMessage[]
  steps: StepResult<ToolSet>[]
}

class HarnessYield extends Error {}

function isTerminal(state: HarnessSnapshot) {
  return ['completed', 'failed', 'cancelled'].includes(state.status)
}

function onlyChildrenRemain(state: HarnessSnapshot) {
  return state.children.some(child => child.status === 'running') && !hasRunnableHarnessMilestones(state)
}

function assertNoControlToolReplacement(tools: ToolSet, controls: Set<string>): void {
  if (Object.keys(tools).some(name => controls.has(name))) {
    throw new Error('Surface tools cannot replace harness control tools.')
  }
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
          const state = await ports.read()
          assertHarnessRunnable(state, Date.now())
          if (!controls.has(name)) {
            if (!state.policy.allowedToolIds.includes(name)) throw new Error('This tool is not authorized for this run.')
            if (state.policy.requiresPlan && !state.plan.length) throw new Error('Create the required plan before executing work.')
            await ports.authorizeTool(name)
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

async function prepareToolDefinitions(tools: ToolSet): Promise<LanguageModelV4FunctionTool[]> {
  return Promise.all(Object.entries(tools).map(async ([name, definition]) => {
    if (definition.type === 'provider' || typeof definition.description === 'function') {
      throw new Error('Harness tools must have prepared function schemas and descriptions.')
    }
    return {
      type: 'function' as const, name, description: definition.description,
      inputSchema: await asSchema(definition.inputSchema).jsonSchema,
      strict: definition.strict, inputExamples: definition.inputExamples as LanguageModelV4FunctionTool['inputExamples'],
      providerOptions: definition.providerOptions,
    }
  }))
}

type WaitingStateOutcome =
  | { kind: 'blocked'; snapshot: HarnessSnapshot }
  | { kind: 'restart'; messages: ModelMessage[]; invocation: number; resetStagnation: boolean }

type HarnessApprovalDecision = NonNullable<Awaited<ReturnType<HarnessExecutionPorts['waitForApproval']>>>[number]
type ApprovalResumeOutcome =
  | { kind: 'blocked'; snapshot: HarnessSnapshot }
  | { kind: 'restart'; messages: ModelMessage[]; resetStagnation: boolean }

async function handleWaitingState(
  state: HarnessSnapshot,
  messages: ModelMessage[],
  ports: HarnessExecutionPorts,
  invocation: number,
): Promise<WaitingStateOutcome | null> {
  if (state.status === 'waiting_for_children') {
    await ports.waitForChildren(state.children.filter(child => child.status === 'running').map(child => child.id))
    const current = await ports.read()
    if (!isTerminal(current)) await ports.apply(`resume-children:${invocation}`, { type: 'resume' })
    return { kind: 'restart', messages, invocation: invocation + (isTerminal(current) ? 0 : 1), resetStagnation: false }
  }
  if (state.status === 'running') return null
  if (state.blocker?.kind !== 'input') return { kind: 'blocked', snapshot: state }
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
): Promise<ApprovalResumeOutcome> {
  assertPendingApprovalsExecutable(pending, tools)
  await ports.apply(`approval:${segment}`, { type: 'block', blocker: { kind: 'approval', question: 'Approval is required before executing these actions.' } })
  const decisions = await ports.waitForApproval(pending)
  if (!decisions) return { kind: 'blocked', snapshot: await ports.read() }
  const state = await ports.read()
  if (isTerminal(state)) return { kind: 'restart', messages, resetStagnation: false }
  assertApprovalDecisions(pending, decisions)
  const resumedMessages = appendApprovalMessages(messages, pending, decisions)
  await ports.apply(`resume-approval:${segment}`, { type: 'resume' })
  approvals.record(pending, decisions)
  return { kind: 'restart', messages: resumedMessages, resetStagnation: true }
}

async function terminateOnProviderFailure(
  state: HarnessSnapshot,
  finishReason: string | undefined,
  ports: HarnessExecutionPorts,
  segment: number,
): Promise<boolean> {
  if (!isTerminal(state) && (finishReason === 'content-filter' || finishReason === 'error' || finishReason === 'other')) {
    await ports.apply(`provider-failure:${segment}`, {
      type: 'terminate', status: 'failed', reason: `The provider could not finish the response (${finishReason}).`,
    })
    return true
  }
  return false
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
  const resultSummary = latestNonEmptyStepText(runSteps, toolNames)
  const finalAnswerRequired = !truncatedResponse && !completionIssues.length && !resultSummary
  if (!truncatedResponse && !completionIssues.length && resultSummary) {
    const completed = await ports.apply(`finish:${segment}`, {
      type: 'finish', ...(resultSummary ? { resultSummary: resultSummary.slice(0, 8_000) } : {}),
    })
    return { kind: 'finished', snapshot: completed }
  }
  const nextStagnantSegments = harnessProgressFingerprint(state) === before ? stagnantSegments + 1 : 0
  if (nextStagnantSegments >= 2) {
    await ports.apply(`stuck:${segment}`, { type: 'block', blocker: { kind: 'stuck', question: 'No durable progress after two continuation attempts. Review the plan or provide the missing input before retrying.' } })
    return { kind: 'continue', stagnantSegments: nextStagnantSegments, finalAnswerRequired }
  }
  const summary = stripTextualToolCalls(state.workingSummary, toolNames)
    || latestNonEmptyStepText(runSteps, toolNames)
  await ports.apply(`checkpoint:${segment}`, { type: 'checkpoint', summary: summary.slice(0, 8_000) })
  return { kind: 'continue', stagnantSegments: nextStagnantSegments, finalAnswerRequired }
}

function latestNonEmptyStepText(steps: StepResult<ToolSet>[], toolNames: ReadonlySet<string>): string {
  for (let index = steps.length - 1; index >= 0; index--) {
    const text = stripTextualToolCalls(steps[index]?.text ?? '', toolNames)
    if (text) return text
  }
  return ''
}

// Called inside a surface's workflow, never inside a single durable step.
// WorkflowAgent owns model/tool iteration; this controller owns task completion.
export async function runOverlayHarness(input: HarnessExecutionInput, ports: HarnessExecutionPorts): Promise<HarnessExecutionResult> {
  if (input.messages.some(message => message.role === 'system')) throw new Error('Supply trusted system content through harness instructions, not conversation messages.')
  let messages = input.messages
  const steps: StepResult<ToolSet>[] = []
  const controls = new Set<string>(HARNESS_CONTROL_TOOLS)
  const toolNames = new Set([...Object.keys(input.tools), ...HARNESS_CONTROL_TOOLS])
  assertNoControlToolReplacement(input.tools, controls)
  const initial = await ports.read()
  let observedState = initial
  if (isTerminal(initial)) return { outcome: 'finished', snapshot: initial, messages, steps }
  if (!await ports.claim()) return { outcome: 'already_running', snapshot: await ports.read(), messages, steps }
  const approvals = createHarnessToolApprovals()
  const tools = wrapAuthorizedTools(input.tools, ports, controls, approvals)
  const toolDefinitions = await prepareToolDefinitions(tools)
  const instructions = buildHarnessInstructions(input.instructions)
  let truncatedResponse = false
  let finalAnswerRequired = false
  let invocation = 0
  let modelCall = 0
  let stagnantSegments = 0

  while (true) {
    const state = await ports.read()
    if (isTerminal(state)) return { outcome: 'finished', snapshot: state, messages, steps }
    const waiting = await handleWaitingState(state, messages, ports, invocation)
    if (waiting) {
      if (waiting.kind === 'blocked') return { outcome: 'blocked', snapshot: waiting.snapshot, messages, steps }
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
      }],
      prepareStep: async ({ messages: prompt }) => {
        let current = await ports.read()
        if (current.status !== 'running') throw new HarnessYield()
        try {
          assertHarnessRunnable(current, Date.now())
        } catch (_error) {
          await ports.apply(`budget:${segment}:${modelCall}`, {
            type: 'block', blocker: { kind: 'budget', question: 'The authorized time or spending budget is exhausted. Review the partial result before starting more work.' },
          })
          throw new HarnessYield()
        }
        const instructionContext = {
          instructions,
          continuation: segment > 0,
          truncatedResponse,
          finalAnswerRequired,
        }
        const receiptId = `model:${modelCall}`
        const prepared = await ports.prepareModel({ receiptId, state: current, messages: prompt, instructionContext,
          toolNames: Object.keys(tools), toolDefinitions, settings: input.settings ?? {} })
        if (!Number.isSafeInteger(prepared.estimatedCostMicros) || prepared.estimatedCostMicros < 0) throw new Error('Invalid model cost reservation.')
        if (prepared.model && prepared.model.credentialOwnerId !== input.model.credentialOwnerId) throw new Error('Model routing cannot change the credential owner.')
        current = await ports.read()
        if (current.status !== 'running') throw new HarnessYield()
        const complete = harnessCompletionIssues(current).length === 0 && current.plan.length > 0
        try {
          assertHarnessRunnable(current, Date.now(), prepared.estimatedCostMicros)
          current = await ports.apply(`reserve:${receiptId}`, { type: 'reserve_model', id: receiptId, maxCostMicros: prepared.estimatedCostMicros })
        } catch (_error) {
          await ports.apply(`budget:${segment}:${modelCall}`, {
            type: 'block', blocker: { kind: 'budget', question: 'The authorized time or spending budget is exhausted. Review the partial result before starting more work.' },
          })
          throw new HarnessYield()
        }
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
      onStepEnd: async step => ports.recordModelStep(step, `model:${modelCall++}`),
      onToolExecutionEnd: async event => {
        if (!controls.has(event.toolCall.toolName)) await ports.recordToolResult(event)
        observedState = await ports.read()
      },
      onEnd: async result => {
        invocationSteps = result.steps
        invocationMessages = result.messages
      },
    })

    let pending: HarnessApprovalRequest[] = []
    let recoveredModel = false
    try {
      const result = await agent.stream({ messages, writable: input.writable, preventClose: true, sendFinish: false })
      invocationMessages = result.messages
      invocationSteps = result.steps
      if ('error' in result && result.error) throw result.error
      pending = unresolvedApprovalCalls(result)
    } catch (error) {
      if (!(error instanceof HarnessYield)) {
        if (!await ports.recoverModelFailure?.(`model:${modelCall}`)) throw error
        modelCall++
        recoveredModel = true
      }
    }
    // WorkflowAgent returns its system prompt in history. Rebuild it exclusively
    // from trusted instructions and current durable state on every invocation.
    messages = invocationMessages.filter(message => message.role !== 'system')
    steps.push(...invocationSteps)
    if (recoveredModel) continue
    const updatedState = await ports.read()
    const finishReason = invocationSteps.at(-1)?.finishReason
    if (await terminateOnProviderFailure(updatedState, finishReason, ports, segment)) continue
    truncatedResponse = finishReason === 'length'
    if (updatedState.status !== 'running') continue
    if (pending.length) {
      const approval = await resumePendingApprovals(pending, tools, messages, ports, segment, approvals)
      if (approval.kind === 'blocked') {
        return { outcome: 'blocked', snapshot: approval.snapshot, messages, steps }
      }
      messages = approval.messages
      if (approval.resetStagnation) stagnantSegments = 0
      continue
    }
    const continuation = await finishOrCheckpointInvocation(updatedState, ports, segment, before, steps, toolNames, truncatedResponse, stagnantSegments)
    if (continuation.kind === 'finished') {
      return { outcome: 'finished', snapshot: continuation.snapshot, messages, steps }
    }
    stagnantSegments = continuation.stagnantSegments
    finalAnswerRequired = continuation.finalAnswerRequired
  }
}
