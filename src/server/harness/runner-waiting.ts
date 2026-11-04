import { FatalError, sleep } from 'workflow'
import type { WorkflowAgentStreamResult } from '@ai-sdk/workflow'
import type { ModelMessage, ToolSet } from 'ai'
import type { HarnessSnapshot } from '@overlay/agent-runtime/harness-state'
import type { HarnessApprovalRequest, HarnessExecutionPorts } from './ports'
import { captureAuthenticatedToolDenials, type AuthenticatedToolDenial } from './tool-outcome-persistence'
import type { HarnessToolApprovals } from './tool-approvals'

type WaitingStateOutcome =
  | { kind: 'blocked'; snapshot: HarnessSnapshot }
  | { kind: 'restart'; messages: ModelMessage[]; invocation: number; resetStagnation: boolean }

type HarnessApprovalDecision = NonNullable<Awaited<ReturnType<HarnessExecutionPorts['waitForApproval']>>>[number]
type ApprovalResumeOutcome =
  | { kind: 'blocked'; snapshot: HarnessSnapshot }
  | { kind: 'restart'; messages: ModelMessage[]; resetStagnation: boolean }

export function isTerminal(state: HarnessSnapshot) {
  return ['completed', 'failed', 'cancelled'].includes(state.status)
}

function isFatalHarnessWaitError(error: unknown): boolean {
  return error instanceof FatalError || Boolean(error && typeof error === 'object'
    && (error as { name?: unknown }).name === 'FatalError')
}

export async function handleWaitingState(
  state: HarnessSnapshot,
  messages: ModelMessage[],
  ports: HarnessExecutionPorts,
  invocation: number,
): Promise<WaitingStateOutcome | null> {
  if (state.status === 'waiting_for_resources' && state.resourcePause) {
    return handleFundingWait(state, messages, ports, invocation)
  }
  if (state.status === 'waiting_for_resources' && state.policy.resourcePauseVersion === 1 && ports.waitForResources) {
    await ports.waitForResources(0)
    return { kind: 'restart', messages, invocation, resetStagnation: false }
  }
  if (state.status === 'waiting_for_children') {
    return handleChildrenWait(state, messages, ports, invocation)
  }
  if (state.status === 'running') return null
  if (state.blocker?.kind !== 'input' && state.blocker?.kind !== 'stuck') return { kind: 'blocked', snapshot: state }
  return handleInputWait(state, messages, ports, invocation)
}

async function handleFundingWait(
  state: HarnessSnapshot,
  messages: ModelMessage[],
  ports: HarnessExecutionPorts,
  invocation: number,
): Promise<WaitingStateOutcome> {
  if (state.policy.executionPolicyVersion !== 2 || state.policy.spendingMode !== 'workspace') {
    return { kind: 'blocked', snapshot: state }
  }
  try {
    if (ports.waitForFunding) await ports.waitForFunding()
    else await sleep('60s')
  } catch (error) {
    if (isFatalHarnessWaitError(error)) throw error
    await sleep('60s')
    return { kind: 'restart', messages, invocation, resetStagnation: false }
  }
  const current = await ports.read()
  if (isTerminal(current) || current.status !== 'waiting_for_resources' || !current.resourcePause) {
    return { kind: 'restart', messages, invocation, resetStagnation: false }
  }
  let funded = false
  try {
    funded = Boolean(ports.checkFunding && await ports.checkFunding(current.resourcePause.requiredCents))
  } catch (error) {
    if (isFatalHarnessWaitError(error)) throw error
    return { kind: 'restart', messages, invocation, resetStagnation: false }
  }
  if (!funded) return { kind: 'restart', messages, invocation, resetStagnation: false }
  await ports.renewLease()
  await ports.apply(`resume-funding:${current.resourcePause.receiptId}`, { type: 'resume_funding' })
  return { kind: 'restart', messages, invocation, resetStagnation: false }
}

async function handleChildrenWait(
  state: HarnessSnapshot,
  messages: ModelMessage[],
  ports: HarnessExecutionPorts,
  invocation: number,
): Promise<WaitingStateOutcome> {
  await ports.waitForChildren(state.children.filter(child => child.status === 'running').map(child => child.id))
  const current = await ports.read()
  if (!isTerminal(current)) await ports.apply(`resume-children:${invocation}`, { type: 'resume' })
  return { kind: 'restart', messages, invocation: invocation + (isTerminal(current) ? 0 : 1), resetStagnation: false }
}

async function handleInputWait(
  state: HarnessSnapshot,
  messages: ModelMessage[],
  ports: HarnessExecutionPorts,
  invocation: number,
): Promise<WaitingStateOutcome> {
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

export function unresolvedApprovalCalls(result: WorkflowAgentStreamResult<ToolSet>): HarnessApprovalRequest[] {
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

export async function resumePendingApprovals(
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
