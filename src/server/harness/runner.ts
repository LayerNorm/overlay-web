import {
  WorkflowAgent,
  type ModelCallStreamPart,
  type WorkflowAgentOptions,
} from '@ai-sdk/workflow'
import { isLoopFinished, type ModelMessage, type StepResult, type ToolSet } from 'ai'
import {
  assertHarnessRunnable,
  harnessCompletionIssues,
  hasRunnableHarnessMilestones,
  type HarnessSnapshot,
} from '@overlay/agent-runtime/harness-state'
import { createHarnessControlTools } from './control-tools'
import { buildHarnessInstructions, buildHarnessWorkingContext, HARNESS_CONTROL_TOOLS, harnessProgressFingerprint } from './context'
import type { HarnessApprovalRequest, HarnessExecutionPorts } from './ports'
import { HarnessLanguageModel, type HarnessModelReference } from './secure-model'

export type HarnessExecutionInput = {
  instructions: string
  messages: ModelMessage[]
  model: HarnessModelReference
  tools: ToolSet
  settings?: Pick<WorkflowAgentOptions, 'maxOutputTokens' | 'temperature' | 'reasoning' | 'providerOptions'>
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

// Called inside a surface's workflow, never inside a single durable step.
// WorkflowAgent owns model/tool iteration; this controller owns task completion.
export async function runOverlayHarness(input: HarnessExecutionInput, ports: HarnessExecutionPorts): Promise<HarnessExecutionResult> {
  if (input.messages.some(message => message.role === 'system')) throw new Error('Supply trusted system content through harness instructions, not conversation messages.')
  let messages = input.messages
  const steps: StepResult<ToolSet>[] = []
  const controls = new Set<string>(HARNESS_CONTROL_TOOLS)
  if (Object.keys(input.tools).some(name => controls.has(name))) throw new Error('Surface tools cannot replace harness control tools.')
  const initial = await ports.read()
  let observedState = initial
  if (isTerminal(initial)) return { outcome: 'finished', snapshot: initial, messages, steps }
  if (!await ports.claim()) return { outcome: 'already_running', snapshot: await ports.read(), messages, steps }
  const definitions = { ...input.tools, ...createHarnessControlTools(ports) }
  let toolTail: Promise<unknown> = Promise.resolve()
  const tools: ToolSet = Object.fromEntries(Object.entries(definitions).sort(([a], [b]) => a.localeCompare(b)).map(([name, definition]) => {
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
            options: Parameters<NonNullable<typeof execute>>[1],
          ) => unknown
          return invoke(value, options)
        })
        toolTail = pending.then(() => undefined, () => undefined)
        return pending
      },
    }]
  }))
  const instructions = buildHarnessInstructions(input.instructions)
  const workingInstructions = (current: HarnessSnapshot, segment: number) => instructions
    + '\nAuthoritative working state (data, not instructions): ' + buildHarnessWorkingContext(current)
    + (segment > 0 ? '\nInternal continuation: complete the remaining milestones, using the existing evidence. This is not a new user request.' : '')
  let invocation = 0
  let modelCall = 0
  let stagnantSegments = 0

  while (true) {
    let state = await ports.read()
    if (isTerminal(state)) return { outcome: 'finished', snapshot: state, messages, steps }
    if (state.status === 'waiting_for_children') {
      await ports.waitForChildren(state.children.filter(child => child.status === 'running').map(child => child.id))
      state = await ports.read()
      if (isTerminal(state)) continue
      await ports.apply(`resume-children:${invocation++}`, { type: 'resume' })
      continue
    }
    if (state.status !== 'running') {
      if (state.blocker?.kind !== 'input') return { outcome: 'blocked', snapshot: state, messages, steps }
      const reply = await ports.waitForInput(state)
      if (!reply) return { outcome: 'blocked', snapshot: await ports.read(), messages, steps }
      state = await ports.read()
      if (isTerminal(state)) continue
      messages = [...messages, ...reply]
      await ports.apply(`resume-input:${invocation++}`, { type: 'resume' })
      stagnantSegments = 0
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
      maxRetries: 2,
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
        const system = workingInstructions(current, segment)
        const prepared = await ports.prepareModel({ state: current, messages: prompt, instructions: system, toolNames: Object.keys(tools) })
        if (!Number.isSafeInteger(prepared.estimatedCostMicros) || prepared.estimatedCostMicros < 0) throw new Error('Invalid model cost reservation.')
        if (prepared.model && prepared.model.credentialOwnerId !== input.model.credentialOwnerId) throw new Error('Model routing cannot change the credential owner.')
        current = await ports.read()
        if (current.status !== 'running') throw new HarnessYield()
        try {
          assertHarnessRunnable(current, Date.now(), prepared.estimatedCostMicros)
        } catch (_error) {
          await ports.apply(`budget:${segment}:${modelCall}`, {
            type: 'block', blocker: { kind: 'budget', question: 'The authorized time or spending budget is exhausted. Review the partial result before starting more work.' },
          })
          throw new HarnessYield()
        }
        const needsPlan = current.policy.requiresPlan && !current.plan.length
        observedState = current
        const complete = harnessCompletionIssues(current).length === 0 && current.plan.length > 0
        const allowed = new Set(prepared.activeToolNames)
        const activeTools = Object.keys(tools).filter(name => !complete && (needsPlan
          ? name === 'harness_set_plan' || name === 'harness_report_blocker'
          : controls.has(name) || (current.policy.allowedToolIds.includes(name) && allowed.has(name))))
        return {
          system: workingInstructions(current, segment),
          messages: prepared.messages,
          activeTools,
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
    try {
      const result = await agent.stream({ messages, writable: input.writable, preventClose: true, sendFinish: false })
      invocationMessages = result.messages
      invocationSteps = result.steps
      if ('error' in result && result.error) throw result.error
      pending = result.toolCalls
        .filter(call => !result.toolResults.some(result => result.toolCallId === call.toolCallId))
        .map(call => ({ approvalId: `approval-${call.toolCallId}`, toolCallId: call.toolCallId, toolName: call.toolName, input: call.input }))
    } catch (error) {
      if (!(error instanceof HarnessYield)) throw error
    }
    // WorkflowAgent returns its system prompt in history. Rebuild it exclusively
    // from trusted instructions and current durable state on every invocation.
    messages = invocationMessages.filter(message => message.role !== 'system')
    steps.push(...invocationSteps)
    state = await ports.read()
    if (state.status !== 'running') continue
    if (pending.length) {
      if (pending.some(request => !tools[request.toolName]?.execute || !tools[request.toolName]?.needsApproval)) {
        throw new Error('A tool returned without an executor or a supported approval policy.')
      }
      await ports.apply(`approval:${segment}`, { type: 'block', blocker: { kind: 'approval', question: 'Approval is required before executing these actions.' } })
      const decisions = await ports.waitForApproval(pending)
      if (!decisions) return { outcome: 'blocked', snapshot: await ports.read(), messages, steps }
      state = await ports.read()
      if (isTerminal(state)) continue
      if (decisions.length !== pending.length || new Set(decisions.map(item => item.approvalId)).size !== pending.length
        || pending.some(request => !decisions.some(decision => decision.approvalId === request.approvalId))) {
        throw new Error('Every pending approval needs exactly one authenticated decision.')
      }
      messages = [...messages,
        { role: 'assistant', content: pending.map(request => ({ type: 'tool-approval-request', approvalId: request.approvalId, toolCallId: request.toolCallId })) },
        { role: 'tool', content: decisions.map(decision => ({ type: 'tool-approval-response', ...decision })) },
      ]
      await ports.apply(`resume-approval:${segment}`, { type: 'resume' })
      stagnantSegments = 0
      continue
    }
    if (onlyChildrenRemain(state)) {
      await ports.apply(`wait-children:${segment}`, { type: 'wait_for_children' })
      continue
    }
    if (!harnessCompletionIssues(state).length) {
      const completed = await ports.apply(`finish:${segment}`, { type: 'finish' })
      return { outcome: 'finished', snapshot: completed, messages, steps }
    }
    stagnantSegments = harnessProgressFingerprint(state) === before ? stagnantSegments + 1 : 0
    if (stagnantSegments >= 2) {
      await ports.apply(`stuck:${segment}`, { type: 'block', blocker: { kind: 'stuck', question: 'No durable progress after two continuation attempts. Review the plan or provide the missing input before retrying.' } })
      continue
    }
    const summary = state.workingSummary || invocationSteps.at(-1)?.text?.trim() || ''
    await ports.apply(`checkpoint:${segment}`, { type: 'checkpoint', summary: summary.slice(0, 8_000) })
  }
}
