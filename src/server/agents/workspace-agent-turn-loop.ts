import { FatalError } from 'workflow'
import type { ModelMessage, ToolModelMessage } from 'ai'
import type { ToolResultOutput } from '@ai-sdk/provider-utils'
import {
  workspaceAgentToolResultFromOutput,
  workspaceAgentToolResultOutput,
  type WorkspaceAgentToolResult,
} from './workspace-agent-turn-utils'
import {
  type WorkspaceAgentModelCall,
  type WorkspaceAgentPreparedContext,
} from './workspace-agent-durable'

type WorkspaceAgentToolCall = WorkspaceAgentModelCall['toolCalls'][number]

export type WorkspaceAgentLoopUsage = {
  inputTokens: number
  outputTokens: number
  usageKnown: boolean
  providerCallStarted: boolean
  providerOutcomeAmbiguous: boolean
}

export type WorkspaceAgentTurnLoopDependencies = {
  beginFirstModelCall: () => Promise<void>
  callModel: (args: {
    prepared: WorkspaceAgentPreparedContext
    messages: ModelMessage[]
    baseParts: Array<Record<string, unknown>>
    modelStep: number
  }) => Promise<WorkspaceAgentModelCall>
  inspectTool: (args: {
    prepared: WorkspaceAgentPreparedContext
    toolCall: WorkspaceAgentToolCall
  }) => Promise<{ available: boolean; needsApproval: boolean }>
  requestApproval: (args: {
    prepared: WorkspaceAgentPreparedContext
    toolCall: WorkspaceAgentToolCall
    cycle: number
  }) => Promise<{ approved: boolean; reason?: string }>
  executeTool: (args: {
    prepared: WorkspaceAgentPreparedContext
    toolCall: WorkspaceAgentToolCall
    approved: boolean
  }) => Promise<WorkspaceAgentToolResult>
  persistProgress: (args: {
    prepared: WorkspaceAgentPreparedContext
    parts: Array<Record<string, unknown>>
  }) => Promise<void>
  finalize: (args: {
    prepared: WorkspaceAgentPreparedContext
    steps: Array<Record<string, unknown>>
    content: string
    inputTokens: number
    outputTokens: number
  }) => Promise<unknown>
}

function errorToolResult(reason: string): WorkspaceAgentToolResult {
  const output = { error: reason }
  return workspaceAgentToolResultFromOutput({ output, display: output, error: reason })
}

function resultMessage(
  toolCall: WorkspaceAgentToolCall,
  output: ToolResultOutput,
): ToolModelMessage['content'][number] {
  return {
    type: 'tool-result',
    toolCallId: toolCall.toolCallId,
    toolName: toolCall.toolName,
    output,
  }
}

async function executeToolCall(args: {
  prepared: WorkspaceAgentPreparedContext
  dependencies: WorkspaceAgentTurnLoopDependencies
  toolCall: WorkspaceAgentToolCall
  approvalCycles: number
}): Promise<{ outcome: WorkspaceAgentToolResult; approvalCycles: number }> {
  const { prepared, dependencies, toolCall } = args
  const inspection = await dependencies.inspectTool({ prepared, toolCall })
  if (!inspection.available) {
    return { outcome: errorToolResult('This action is no longer authorized.'), approvalCycles: args.approvalCycles }
  }
  if (!inspection.needsApproval) {
    return {
      outcome: await dependencies.executeTool({ prepared, toolCall, approved: false }),
      approvalCycles: args.approvalCycles,
    }
  }

  const approvalCycles = args.approvalCycles + 1
  if (approvalCycles > prepared.maxSteps) {
    throw new FatalError('Agent turn exceeded its approval cycle limit.')
  }
  const decision = await dependencies.requestApproval({ prepared, toolCall, cycle: approvalCycles })
  if (!decision || typeof decision.approved !== 'boolean') {
    throw new FatalError('Approval response was malformed.')
  }
  if (!decision.approved) {
    return {
      outcome: errorToolResult(decision.reason ?? 'The action was not approved.'),
      approvalCycles,
    }
  }
  return {
    outcome: await dependencies.executeTool({ prepared, toolCall, approved: true }),
    approvalCycles,
  }
}

export async function runWorkspaceAgentTurnLoop(args: {
  prepared: WorkspaceAgentPreparedContext
  dependencies: WorkspaceAgentTurnLoopDependencies
  usage: WorkspaceAgentLoopUsage
}) {
  const { prepared, dependencies, usage } = args
  let messages = prepared.messages
  let content = ''
  let transcriptParts: Array<Record<string, unknown>> = []
  const steps: Array<Record<string, unknown>> = []
  let approvalCycles = 0

  for (let modelStep = 0; modelStep < prepared.maxSteps; modelStep += 1) {
    if (modelStep === 0) {
      await dependencies.beginFirstModelCall()
      usage.providerCallStarted = true
    }
    let call: WorkspaceAgentModelCall
    try {
      call = await dependencies.callModel({ prepared, messages, baseParts: transcriptParts, modelStep })
    } catch (error) {
      usage.providerOutcomeAmbiguous = error instanceof Error
        && error.message.includes('Native agent provider')
      throw error
    }
    const hasInputUsage = Number.isFinite(call.usage.inputTokens) && (call.usage.inputTokens ?? -1) >= 0
    const hasOutputUsage = Number.isFinite(call.usage.outputTokens) && (call.usage.outputTokens ?? -1) >= 0
    usage.usageKnown &&= hasInputUsage && hasOutputUsage
    usage.inputTokens += call.usage.inputTokens ?? 0
    usage.outputTokens += call.usage.outputTokens ?? 0
    transcriptParts = call.transcriptParts
    content += call.text
    const toolResults: Array<Record<string, unknown>> = []
    const toolMessageContent: ToolModelMessage['content'] = []
    steps.push({
      content: call.parts,
      text: call.text,
      toolCalls: call.toolCalls,
      toolResults,
      response: { messages: call.responseMessages },
      usage: call.usage,
      finishReason: call.finishReason,
    })
    if (!call.toolCalls.length) {
      if (!call.text.trim()) throw new FatalError('The agent returned an empty response.')
      const result = await dependencies.finalize({
        prepared,
        steps,
        content,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
      })
      return { result, content, transcriptParts, steps }
    }

    for (const toolCall of call.toolCalls) {
      const resolution = await executeToolCall({ prepared, dependencies, toolCall, approvalCycles })
      approvalCycles = resolution.approvalCycles
      const { outcome } = resolution
      toolResults.push({
        type: outcome.error || outcome.refusedApproval ? 'tool-error' : 'tool-result',
        toolCallId: toolCall.toolCallId,
        toolName: toolCall.toolName,
        input: toolCall.input,
        output: outcome.display,
      })
      toolMessageContent.push(resultMessage(toolCall, workspaceAgentToolResultOutput(outcome)))
      transcriptParts.push({
        type: 'tool-invocation',
        toolInvocation: {
          toolCallId: toolCall.toolCallId,
          toolName: toolCall.toolName,
          state: outcome.error || outcome.refusedApproval ? 'output-error' : 'output-available',
          toolInput: toolCall.input,
          toolOutput: outcome.display,
        },
      })
      await dependencies.persistProgress({ prepared, parts: transcriptParts })
    }
    messages = [
      ...messages,
      ...call.responseMessages,
      { role: 'tool', content: toolMessageContent },
    ]
  }
  throw new FatalError('Agent turn exceeded its model step limit.')
}
