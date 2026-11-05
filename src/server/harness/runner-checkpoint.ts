import type { ModelMessage, StepResult, ToolSet } from 'ai'
import type { HarnessRunnerCheckpoint, HarnessApprovalRequest } from './ports'
import { withObservedToolOutcomes, type AuthenticatedToolDenial, type ObservedToolOutcome } from './tool-outcome-persistence'
import { stripHarnessBookkeeping } from './public-text'
import { HARNESS_CONTROL_TOOLS } from './context'

function checkpointDeliverySteps(
  steps: StepResult<ToolSet>[],
  outcomes: ReadonlyMap<string, ObservedToolOutcome>,
  denials: ReadonlyMap<string, AuthenticatedToolDenial>,
  toolNames: ReadonlySet<string>,
): StepResult<ToolSet>[] {
  const settled = withObservedToolOutcomes({
    outcome: 'continued',
    snapshot: {} as never,
    messages: [],
    steps,
  }, outcomes, denials).steps
  return settled.map(step => JSON.parse(JSON.stringify({
    ...(step.stepNumber !== undefined ? { stepNumber: step.stepNumber } : {}),
    ...(step.content ? { content: step.content.map(part => part.type === 'text' && typeof part.text === 'string'
      ? { ...part, text: stripHarnessBookkeeping(part.text, toolNames) } : part) } : {}),
    ...(step.text !== undefined ? { text: stripHarnessBookkeeping(step.text, toolNames) } : {}),
    ...(step.toolCalls ? { toolCalls: step.toolCalls } : {}),
    ...(step.toolResults ? { toolResults: step.toolResults } : {}),
    ...(step.usage ? { usage: step.usage } : {}),
    ...(step.finishReason !== undefined ? { finishReason: step.finishReason } : {}),
  })) as StepResult<ToolSet>)
}

export function buildHarnessRunnerCheckpoint(input: {
  stepReceiptIds?: Array<string | undefined>
  publicProgress?: HarnessRunnerCheckpoint['publicProgress']
  messages: ModelMessage[]
  invocation: number
  modelCall: number
  stagnantSegments: number
  finalAnswerRequired: boolean
  toolNames?: ReadonlySet<string>
  truncatedResponse: boolean
  segmentStartedAt: number
  deliverySteps: StepResult<ToolSet>[]
  pendingApproval?: { requests: HarnessApprovalRequest[]; segment: number }
  toolApprovals: HarnessRunnerCheckpoint['toolApprovals']
  executionOutcomes: Map<string, ObservedToolOutcome>
  authenticatedDenials: Map<string, AuthenticatedToolDenial>
}): HarnessRunnerCheckpoint {
  const toolNames = new Set([...HARNESS_CONTROL_TOOLS, ...(input.toolNames ?? [])])
  const messages = input.messages.map(message => message.role === 'assistant'
    ? {
      ...message,
      content: typeof message.content === 'string'
        ? stripHarnessBookkeeping(message.content, toolNames)
        : message.content.map(part => part.type === 'text' && typeof part.text === 'string'
          ? { ...part, text: stripHarnessBookkeeping(part.text, toolNames) }
          : part),
    } : message)
  const deliverySteps = checkpointDeliverySteps(input.deliverySteps, input.executionOutcomes, input.authenticatedDenials, toolNames)
  return {
    version: 1,
    ...(input.stepReceiptIds ? { stepReceiptIds: input.stepReceiptIds } : {}),
    messages,
    ...(input.publicProgress ? { publicProgress: input.publicProgress } : {}),
    invocation: input.invocation,
    modelCall: input.modelCall,
    stagnantSegments: input.stagnantSegments,
    finalAnswerRequired: input.finalAnswerRequired,
    truncatedResponse: input.truncatedResponse,
    segmentStartedAt: input.segmentStartedAt,
    deliverySteps,
    ...(input.pendingApproval ? { pendingApproval: input.pendingApproval } : {}),
    toolApprovals: input.toolApprovals,
    executionOutcomes: [...input.executionOutcomes],
    authenticatedDenials: [...input.authenticatedDenials],
  }
}
