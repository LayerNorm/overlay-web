import type { LanguageModelV4FunctionTool, LanguageModelV4Prompt } from '@ai-sdk/provider'
import type {
  WorkflowAgentOnStepEndCallback,
  WorkflowAgentToolExecutionEndEvent,
  WorkflowAgentOptions,
} from '@ai-sdk/workflow'
import type { ModelMessage, StepResult, ToolSet } from 'ai'
import type { HarnessChild, HarnessEvidence, HarnessSnapshot } from '@overlay/agent-runtime/harness-state'
import type { HarnessOperation } from '@overlay/agent-runtime/harness-store'
import type { HarnessModelReference } from './secure-model'
import type { HarnessInstructionContext } from './context'
import type { HarnessToolApprovalGrant } from './tool-approvals'
import type { AuthenticatedToolDenial, ObservedToolOutcome } from './tool-outcome-persistence'

export type HarnessModelSettings = Pick<WorkflowAgentOptions, 'maxOutputTokens' | 'temperature' | 'reasoning' | 'providerOptions'>

export type HarnessDelegation = {
  stepId: string
  goal: string
  constraints: string[]
  allowedToolIds: string[]
  maxCostMicros: number
}

export type HarnessApprovalRequest = {
  approvalId: string
  toolCallId: string
  toolName: string
  input: unknown
}

export type HarnessArtifactRead = {
  artifactId: string
  start?: number
  end?: number
  mediaPart?: number
}

export type HarnessArtifactReadResult =
  | { kind: 'text'; text: string; metadata: { artifactId: string; toolName: string; toolCallId: string; mediaPartCount: number; resource?: { id: string; revision?: string; operation?: string; page?: number } } }
  | { kind: 'media'; data: Uint8Array; mediaType: string; metadata: { artifactId: string; toolName: string; toolCallId: string; mediaPartCount: number; mediaPart: number; resource?: { id: string; revision?: string; operation?: string; page?: number } } }

export type HarnessRunnerCheckpoint = {
  version: 1
  messages: ModelMessage[]
  stepReceiptIds?: Array<string | undefined>
  deliverySteps?: StepResult<ToolSet>[]
  invocation: number
  modelCall: number
  stagnantSegments: number
  finalAnswerRequired: boolean
  truncatedResponse: boolean
  segmentStartedAt: number
  publicProgress?: { due: boolean; silentToolBatches: number }
  deliveryProgress?: string
  pendingApproval?: { requests: HarnessApprovalRequest[]; segment: number }
  toolApprovals?: HarnessToolApprovalGrant[]
  executionOutcomes?: Array<[string, ObservedToolOutcome]>
  authenticatedDenials?: Array<[string, AuthenticatedToolDenial]>
}

// These are IO seams, not execution strategies. Implementations invoke durable
// steps/hooks; no provider instances, credentials or closures enter run storage.
export interface HarnessExecutionPorts {
  fileAnalysisEnabled?: boolean
  readFileCoverage?(childRunId: string): Promise<unknown>
  claim(): Promise<boolean>
  read(): Promise<HarnessSnapshot>
  apply(operationId: string, operation: HarnessOperation): Promise<HarnessSnapshot>
  readEvidence(
    evidenceId: string,
    cursor?: string,
    limit?: number,
  ): Promise<HarnessEvidence | null | { observations: Array<Pick<HarnessEvidence, 'id' | 'source' | 'verdict' | 'createdAt'>>; nextCursor: string | null }>
  waitForResources?(requiredCostMicros: number): Promise<HarnessSnapshot>
  waitForFunding?(): Promise<void>
  checkFunding?(requiredCents: number): Promise<boolean>
  renewLease(): Promise<void>
  continueExecution(checkpoint: HarnessRunnerCheckpoint): Promise<HarnessSnapshot>
  authorizeTool(toolName: string): Promise<void>
  readArtifact?(input: HarnessArtifactRead): Promise<HarnessArtifactReadResult>
  prepareModel(input: {
    receiptId: string
    state: HarnessSnapshot
    messages: LanguageModelV4Prompt
    instructionContext: HarnessInstructionContext
    toolNames: string[]
    toolDefinitions: LanguageModelV4FunctionTool[]
    settings: HarnessModelSettings
  }): Promise<{
    messages: LanguageModelV4Prompt
    activeToolNames: string[]
    estimatedCostMicros: number
    model?: HarnessModelReference
    instructions?: string
    settings?: HarnessModelSettings
  }>
  recordModelStep(step: Parameters<WorkflowAgentOnStepEndCallback<ToolSet>>[0], receiptId: string): Promise<void>
  recoverModelFailure?(receiptId: string): Promise<boolean>
  recordToolResult(event: WorkflowAgentToolExecutionEndEvent<ToolSet>): Promise<void>
  delegate(input: HarnessDelegation, toolCallId: string): Promise<HarnessChild>
  readChild(childRunId: string): Promise<HarnessSnapshot>
  waitForChildren(childRunIds: string[]): Promise<void>
  waitForInput(state: HarnessSnapshot): Promise<ModelMessage[] | null>
  waitForApproval(requests: HarnessApprovalRequest[]): Promise<Array<{
    approvalId: string
    approved: boolean
    reason?: string
  }> | null>
}
