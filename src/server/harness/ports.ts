import type { LanguageModelV4FunctionTool, LanguageModelV4Prompt } from '@ai-sdk/provider'
import type {
  WorkflowAgentOnStepEndCallback,
  WorkflowAgentToolExecutionEndEvent,
  WorkflowAgentOptions,
} from '@ai-sdk/workflow'
import type { ModelMessage, ToolSet } from 'ai'
import type { HarnessChild, HarnessEvidence, HarnessSnapshot } from '@overlay/agent-runtime/harness-state'
import type { HarnessOperation } from '@overlay/agent-runtime/harness-store'
import type { HarnessModelReference } from './secure-model'
import type { HarnessInstructionContext } from './context'

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

// These are IO seams, not execution strategies. Implementations invoke durable
// steps/hooks; no provider instances, credentials or closures enter run storage.
export interface HarnessExecutionPorts {
  claim(): Promise<boolean>
  read(): Promise<HarnessSnapshot>
  apply(operationId: string, operation: HarnessOperation): Promise<HarnessSnapshot>
  readEvidence(evidenceId: string): Promise<HarnessEvidence | null>
  authorizeTool(toolName: string): Promise<void>
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
