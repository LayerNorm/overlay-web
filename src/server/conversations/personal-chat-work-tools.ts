import 'server-only'

import { asSchema, type ToolSet } from 'ai'
import { getStepMetadata } from 'workflow'
import type {
  PersonalChatWorkToolDefinition,
  PersonalChatWorkToolingContext,
} from '@/shared/agents/personal-chat-work'
import { prepareActTooling, preloadActExternalToolTasks } from '@/server/app-api/v1/conversations/act/tooling'
import { getInternalApiSecret } from '@/server/shared/internal-api-secret'

export async function describePersonalChatWorkTools(
  tools: ToolSet,
  hasDynamicApproval: boolean,
): Promise<PersonalChatWorkToolDefinition[]> {
  return await Promise.all(Object.entries(tools).map(async ([name, definition]) => ({
    name,
    description: typeof definition.description === 'string' ? definition.description : undefined,
    inputSchema: await asSchema(definition.inputSchema).jsonSchema as Record<string, unknown>,
    needsApproval: Boolean(definition.needsApproval) || (hasDynamicApproval && name === 'call_mcp_tool'),
  })))
}

async function reconstructTooling(
  context: PersonalChatWorkToolingContext,
  idempotencyKey?: string,
) {
  return await prepareActTooling({
    ...context,
    accessToken: undefined,
    automationExecution: false,
    automationMode: false,
    forwardCookie: undefined,
    idempotencyKey,
    isMultiModelFollowUpSlot: false,
    mediaToolIntent: null,
    mode: 'chat',
    preloadTasks: preloadActExternalToolTasks({
      userId: context.userId,
      serverSecret: getInternalApiSecret(),
    }),
    requestedToolIds: context.requestedToolIds as never,
    serverSecret: getInternalApiSecret(),
  })
}

export async function executePersonalChatWorkTool(
  input: unknown,
  options: {
    context: PersonalChatWorkToolingContext & { agentRunId: string; toolName: string }
    messages: unknown[]
    toolCallId: string
  },
): Promise<unknown> {
  'use step'

  const { agentRunId, toolName, ...toolingContext } = options.context
  const logicalStepId = options.toolCallId || getStepMetadata().stepId
  const idempotencyKey = `agent-run:${agentRunId}:tool:${logicalStepId}`
  const tooling = await reconstructTooling(toolingContext, idempotencyKey)
  const definition = tooling.tools[toolName]
  if (!definition || typeof definition.execute !== 'function') {
    throw new Error(`Tool ${toolName} is no longer available for this Work run.`)
  }
  return await definition.execute(input as never, {
    toolCallId: options.toolCallId,
    messages: options.messages,
    context: tooling.toolsContext?.[toolName],
    agentRunId,
    logicalStepId,
    idempotencyKey,
  } as never)
}

export async function personalChatWorkToolNeedsApproval(
  input: unknown,
  options: {
    context: PersonalChatWorkToolingContext & { agentRunId: string; toolName: string }
    messages: unknown[]
    toolCallId: string
  },
): Promise<boolean> {
  'use step'

  const { agentRunId: _agentRunId, toolName, ...toolingContext } = options.context
  const tooling = await reconstructTooling(toolingContext)
  const definition = tooling.tools[toolName]
  if (!definition) return false
  if (typeof definition.needsApproval === 'boolean') return definition.needsApproval
  if (typeof definition.needsApproval === 'function') {
    return await definition.needsApproval(input as never, {
      toolCallId: options.toolCallId,
      messages: options.messages,
      context: tooling.toolsContext?.[toolName],
    } as never)
  }
  return tooling.toolApproval?.({
    toolCall: {
      toolName,
      input: (input && typeof input === 'object' ? input : {}) as Record<string, unknown>,
    },
  }) === 'user-approval'
}
