import type { WorkflowAgentToolExecutionEndEvent } from '@ai-sdk/workflow'
import type { StepResult, ToolSet } from 'ai'
import type { HarnessApprovalRequest } from './ports'
import type { HarnessExecutionResult } from './runner'

export type ObservedToolOutcome =
  | { toolCallId: string; toolName: string; input: unknown; success: true; output: unknown }
  | { toolCallId: string; toolName: string; input: unknown; success: false; error: unknown }

export type AuthenticatedToolDenial = {
  approvalId: string
  approved: false
  reason?: string
  toolCall: { type: 'tool-call'; toolCallId: string; toolName: string; input: unknown }
}

export function captureObservedToolOutcome(
  event: WorkflowAgentToolExecutionEndEvent<ToolSet>,
  outcomes: Map<string, ObservedToolOutcome>,
): void {
  const { toolCallId, toolName, input } = event.toolCall
  outcomes.set(toolCallId, event.success
    ? { toolCallId, toolName, input, success: true, output: event.output }
    : { toolCallId, toolName, input, success: false, error: event.error })
}

export function captureAuthenticatedToolDenials(
  pending: HarnessApprovalRequest[],
  decisions: Array<{ approvalId: string; approved: boolean; reason?: string }>,
  denials: Map<string, AuthenticatedToolDenial>,
): void {
  for (const decision of decisions) {
    if (decision.approved) continue
    const request = pending.find(item => item.approvalId === decision.approvalId)
    if (!request) continue
    denials.set(request.toolCallId, {
      approvalId: request.approvalId,
      approved: false,
      ...(decision.reason === undefined ? {} : { reason: decision.reason }),
      toolCall: {
        type: 'tool-call',
        toolCallId: request.toolCallId,
        toolName: request.toolName,
        input: request.input,
      },
    })
  }
}

function matchingCall(value: unknown, toolCallId: string, toolName: string): boolean {
  return value !== null && typeof value === 'object'
    && 'toolCallId' in value && value.toolCallId === toolCallId
    && 'toolName' in value && value.toolName === toolName
}

function normalizeExecutionSteps(
  steps: StepResult<ToolSet>[],
  outcomes: ReadonlyMap<string, ObservedToolOutcome>,
  denials: ReadonlyMap<string, AuthenticatedToolDenial>,
): StepResult<ToolSet>[] {
  return steps.map(step => {
    const calls = [
      ...(step.toolCalls ?? []),
      ...(step.content ?? []).filter(part => part.type === 'tool-call'),
    ]
    let content: NonNullable<StepResult<ToolSet>['content']> | undefined
    const ensureContent = () => {
      content ??= step.content?.length
        ? [...step.content]
        : [
            ...(step.reasoningText?.trim() ? [{ type: 'reasoning' as const, text: step.reasoningText }] : []),
            ...(step.toolCalls ?? []).map(call => ({ ...call, type: 'tool-call' as const })),
            ...(step.text?.trim() ? [{ type: 'text' as const, text: step.text }] : []),
          ]
      return content
    }

    const seenCalls = new Set<string>()
    for (const call of calls) {
      const { toolCallId, toolName } = call
      const identity = `${toolCallId}\u0000${toolName}`
      if (seenCalls.has(identity)) continue
      seenCalls.add(identity)
      const denial = denials.get(toolCallId)
      const outcome = outcomes.get(toolCallId)
      const match = denial
        ? denial.toolCall.toolName === toolName
        : outcome?.toolName === toolName
      if (!match) continue
      const existing = [
        ...(content ?? step.content ?? []),
        ...(step.toolResults ?? []),
      ].some(part => (
        part.type === 'tool-result' || part.type === 'tool-error' || part.type === 'tool-approval-response'
      ) && matchingCall(part.type === 'tool-approval-response' && 'toolCall' in part
        ? part.toolCall
        : part, toolCallId, toolName))
      if (existing) continue

      const part = denial
        ? {
            type: 'tool-approval-response' as const,
            approvalId: denial.approvalId,
            approved: false as const,
            ...(denial.reason === undefined ? {} : { reason: denial.reason }),
            toolCall: denial.toolCall,
          }
        : outcome?.success
          ? {
              type: 'tool-result' as const,
              toolCallId,
              toolName,
              input: outcome.input,
              output: outcome.output,
            }
          : outcome
            ? {
                type: 'tool-error' as const,
                toolCallId,
                toolName,
                input: outcome.input,
                error: outcome.error,
              }
            : null
      if (!part) continue

      const nextContent = ensureContent()
      const callIndex = nextContent.findIndex(candidate => (
        candidate.type === 'tool-call' && matchingCall(candidate, toolCallId, toolName)
      ))
      nextContent.splice(callIndex < 0 ? nextContent.length : callIndex + 1, 0, part)
    }
    return content ? { ...step, content } : step
  })
}

export function withObservedToolOutcomes(
  result: HarnessExecutionResult,
  outcomes: ReadonlyMap<string, ObservedToolOutcome>,
  denials: ReadonlyMap<string, AuthenticatedToolDenial>,
): HarnessExecutionResult {
  return { ...result, steps: normalizeExecutionSteps(result.steps, outcomes, denials) }
}
