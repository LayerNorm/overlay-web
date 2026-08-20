import { WorkflowAgent, type ModelCallStreamPart } from '@ai-sdk/workflow'
import { isStepCount, jsonSchema, tool, type ModelMessage, type StepResult, type ToolSet } from 'ai'
import { createHook, FatalError, getWorkflowMetadata, getWritable } from 'workflow'
import type {
  PersonalChatWorkToolDefinition,
  PersonalChatWorkToolingContext,
} from '@/shared/agents/personal-chat-work'
import type { SourceCitationMap } from '@/shared/knowledge/ask-knowledge-types'
import {
  executePersonalChatWorkTool,
  personalChatWorkToolNeedsApproval,
} from '@/server/conversations/personal-chat-work-tools'
import {
  attachPersonalChatWorkRun,
  failPersonalChatWork,
  finalizePersonalChatWork,
  markPersonalChatWorkResumed,
  markPersonalChatWorkWaiting,
} from '@/server/conversations/personal-chat-work-lifecycle'

export type PersonalChatWorkWorkflowInput = {
  agentRunId: string
  billingUserId: string
  conversationId: string
  emitWebhook: boolean
  gatewayModelId: string
  instructions: string
  messages: ModelMessage[]
  modelId: string
  multiModelSlotIndex?: number
  multiModelTotal?: number
  paid: boolean
  providerOptions?: Record<string, Record<string, unknown>>
  reasoning?: 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'
  reservationId: string | null
  resourceUserId: string
  sourceCitations?: SourceCitationMap
  toolDefinitions: PersonalChatWorkToolDefinition[]
  toolingContext: PersonalChatWorkToolingContext
  turnId: string
}

const toolContextSchema = jsonSchema<PersonalChatWorkToolingContext & {
  agentRunId: string
  toolName: string
}>({
  type: 'object',
  additionalProperties: true,
  required: ['agentRunId', 'toolName'],
  properties: {
    agentRunId: { type: 'string' },
    toolName: { type: 'string' },
  },
})

function buildWorkflowTools(
  definitions: PersonalChatWorkToolDefinition[],
): ToolSet {
  return Object.fromEntries(definitions.map((definition) => [
    definition.name,
    tool({
      description: definition.description,
      inputSchema: jsonSchema(definition.inputSchema),
      contextSchema: toolContextSchema,
      execute: executePersonalChatWorkTool,
      ...(definition.needsApproval
        ? { needsApproval: personalChatWorkToolNeedsApproval }
        : {}),
    }),
  ]))
}

export function aggregatePersonalChatWorkUsage(steps: StepResult<ToolSet>[]) {
  return steps.reduce((usage, step) => ({
    inputTokens: usage.inputTokens + (step.usage?.inputTokens ?? 0),
    outputTokens: usage.outputTokens + (step.usage?.outputTokens ?? 0),
  }), { inputTokens: 0, outputTokens: 0 })
}

export function buildPersonalChatWorkApprovalToken(agentRunId: string, approvalCycle: number) {
  return `agent-run:${agentRunId}:approval:${approvalCycle}`
}

async function closeWorkStream() {
  'use step'
  const writable = getWritable<ModelCallStreamPart<ToolSet>>()
  await writable.close()
}

async function failWorkStream(error: unknown) {
  'use step'
  const writable = getWritable<ModelCallStreamPart<ToolSet>>()
  const writer = writable.getWriter()
  try {
    const message = error instanceof Error ? error.message : 'Unknown workflow failure'
    await writer.write({ type: 'error', error: new Error(message) } as unknown as ModelCallStreamPart<ToolSet>)
  } finally {
    await writer.close()
  }
}

export async function personalChatWorkWorkflow(input: PersonalChatWorkWorkflowInput) {
  'use workflow'

  const { workflowRunId } = getWorkflowMetadata()
  await attachPersonalChatWorkRun({
    agentRunId: input.agentRunId,
    resourceUserId: input.resourceUserId,
    workflowRunId,
  })

  const writable = getWritable<ModelCallStreamPart<ToolSet>>()
  const allSteps: StepResult<ToolSet>[] = []
  try {
    const tools = buildWorkflowTools(input.toolDefinitions)
    const toolsContext = Object.fromEntries(input.toolDefinitions.map((definition) => [
      definition.name,
      {
        ...input.toolingContext,
        agentRunId: input.agentRunId,
        toolName: definition.name,
      },
    ]))
    const agent = new WorkflowAgent({
      id: `personal-chat-work:${input.agentRunId}`,
      model: input.gatewayModelId,
      tools,
      toolsContext,
      instructions: input.instructions,
      allowSystemInMessages: true,
      maxOutputTokens: 32_768,
      maxRetries: 0,
      stopWhen: isStepCount(64),
      ...(input.reasoning ? { reasoning: input.reasoning } : {}),
      ...(input.providerOptions ? { providerOptions: input.providerOptions } : {}),
    } as never)

    let messages = input.messages
    for (let approvalCycle = 0; approvalCycle < 20; approvalCycle += 1) {
      const result = await agent.stream({
        messages,
        writable,
        preventClose: true,
        sendFinish: false,
      })
      allSteps.push(...result.steps)
      const completedToolCallIds = new Set(result.toolResults.map((part) => part.toolCallId))
      const approvalRequests = result.toolCalls.filter((call) => {
        if (completedToolCallIds.has(call.toolCallId)) return false
        return input.toolDefinitions.some((definition) =>
          definition.name === call.toolName && definition.needsApproval)
      })

      if (approvalRequests.length === 0) {
        const finalText = allSteps.at(-1)?.text ?? ''
        await finalizePersonalChatWork({
          agentRunId: input.agentRunId,
          billingUserId: input.billingUserId,
          conversationId: input.conversationId,
          emitWebhook: input.emitWebhook,
          event: {
            steps: allSteps,
            text: finalText,
            usage: aggregatePersonalChatWorkUsage(allSteps),
          },
          modelId: input.modelId,
          multiModelSlotIndex: input.multiModelSlotIndex,
          multiModelTotal: input.multiModelTotal,
          paid: input.paid,
          reservationId: input.reservationId,
          resourceUserId: input.resourceUserId,
          sourceCitations: input.sourceCitations,
          turnId: input.turnId,
          workflowRunId,
        })
        await closeWorkStream()
        return { agentRunId: input.agentRunId, completed: true }
      }

      const token = buildPersonalChatWorkApprovalToken(input.agentRunId, approvalCycle)
      await markPersonalChatWorkWaiting({
        agentRunId: input.agentRunId,
        resourceUserId: input.resourceUserId,
        approval: {
          token,
          requestedAt: Date.now(),
          requests: approvalRequests.map((call) => ({
            approvalId: `approval-${call.toolCallId}`,
            toolCallId: call.toolCallId,
            toolName: call.toolName,
            input: call.input,
          })),
        },
      })
      const decision = await createHook<{ approved: boolean; reason?: string }>({ token })
      await markPersonalChatWorkResumed({
        agentRunId: input.agentRunId,
        resourceUserId: input.resourceUserId,
      })
      messages = [
        ...result.messages,
        {
          role: 'tool',
          content: approvalRequests.map((call) => ({
            type: 'tool-approval-response' as const,
            approvalId: `approval-${call.toolCallId}`,
            approved: decision.approved,
            ...(decision.reason ? { reason: decision.reason } : {}),
          })),
        },
      ]
    }
    throw new FatalError('Work mode exceeded the maximum number of approval cycles.')
  } catch (error) {
    await failWorkStream(error)
    const errorMessage = error instanceof Error ? error.message : 'Unknown workflow failure'
    await failPersonalChatWork({
      agentRunId: input.agentRunId,
      billingUserId: input.billingUserId,
      errorMessage,
      modelId: input.modelId,
      reservationId: input.reservationId,
      resourceUserId: input.resourceUserId,
      steps: allSteps,
      workflowRunId,
    })
    throw error
  }
}
