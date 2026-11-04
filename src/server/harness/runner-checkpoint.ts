import type { ModelMessage, StepResult, ToolSet } from 'ai'
import type { HarnessRunnerCheckpoint, HarnessApprovalRequest } from './ports'
import { withObservedToolOutcomes, type AuthenticatedToolDenial, type ObservedToolOutcome } from './tool-outcome-persistence'

function checkpointDeliverySteps(
  steps: StepResult<ToolSet>[],
  outcomes: ReadonlyMap<string, ObservedToolOutcome>,
  denials: ReadonlyMap<string, AuthenticatedToolDenial>,
): StepResult<ToolSet>[] {
  const settled = withObservedToolOutcomes({
    outcome: 'continued',
    snapshot: {} as never,
    messages: [],
    steps,
  }, outcomes, denials).steps
  return settled.map(step => JSON.parse(JSON.stringify({
    ...(step.stepNumber !== undefined ? { stepNumber: step.stepNumber } : {}),
    ...(step.content ? { content: step.content } : {}),
    ...(step.text !== undefined ? { text: step.text } : {}),
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
  truncatedResponse: boolean
  segmentStartedAt: number
  deliverySteps: StepResult<ToolSet>[]
  pendingApproval?: { requests: HarnessApprovalRequest[]; segment: number }
  toolApprovals: HarnessRunnerCheckpoint['toolApprovals']
  executionOutcomes: Map<string, ObservedToolOutcome>
  authenticatedDenials: Map<string, AuthenticatedToolDenial>
}): HarnessRunnerCheckpoint {
  return {
    version: 1,
    ...(input.stepReceiptIds ? { stepReceiptIds: input.stepReceiptIds } : {}),
    messages: input.messages,
    ...(input.publicProgress ? { publicProgress: input.publicProgress } : {}),
    invocation: input.invocation,
    modelCall: input.modelCall,
    stagnantSegments: input.stagnantSegments,
    finalAnswerRequired: input.finalAnswerRequired,
    truncatedResponse: input.truncatedResponse,
    segmentStartedAt: input.segmentStartedAt,
    deliverySteps: checkpointDeliverySteps(input.deliverySteps, input.executionOutcomes, input.authenticatedDenials),
    ...(input.pendingApproval ? { pendingApproval: input.pendingApproval } : {}),
    toolApprovals: input.toolApprovals,
    executionOutcomes: [...input.executionOutcomes],
    authenticatedDenials: [...input.authenticatedDenials],
  }
}
