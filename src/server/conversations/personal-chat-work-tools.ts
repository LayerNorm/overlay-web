import 'server-only'

import { asSchema, type ToolSet } from 'ai'
import { getStepMetadata } from 'workflow'
import type {
  PersonalChatWorkToolDefinition,
  PersonalChatWorkToolingContext,
} from '@/shared/agents/personal-chat-work'
import { prepareActTooling, preloadActExternalToolTasks } from '@/server/app-api/v1/conversations/act/tooling'
import { getInternalApiSecret } from '@/server/shared/internal-api-secret'

/**
 * JSON Schema keywords the AI Gateway's strict tool-schema validation rejects.
 * `format` is the observed failure: several overlay/MCP tool schemas annotate
 * string params with `format: "uri"`/`"date-time"`, which upstream providers
 * (OpenAI strict mode) refuse, and the whole durable run dies with a schema
 * error. The annotations are advisory only — dropping them does not change
 * what the model may pass.
 */
const WORKFLOW_UNSUPPORTED_SCHEMA_KEYS = new Set(['format'])

export function sanitizeWorkflowToolSchemaValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeWorkflowToolSchemaValue)
  if (!value || typeof value !== 'object') return value
  const clean: Record<string, unknown> = {}
  for (const [key, child] of Object.entries(value)) {
    if (WORKFLOW_UNSUPPORTED_SCHEMA_KEYS.has(key)) continue
    clean[key] = sanitizeWorkflowToolSchemaValue(child)
  }
  return clean
}

export async function describePersonalChatWorkTools(
  tools: ToolSet,
  hasDynamicApproval: boolean,
): Promise<PersonalChatWorkToolDefinition[]> {
  return await Promise.all(Object.entries(tools).map(async ([name, definition]) => ({
    name,
    description: typeof definition.description === 'string' ? definition.description : undefined,
    inputSchema: sanitizeWorkflowToolSchemaValue(
      await asSchema(definition.inputSchema).jsonSchema,
    ) as Record<string, unknown>,
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
    automationExecution: context.automationExecution === true,
    automationId: context.automationId,
    automationMode: false,
    forwardCookie: undefined,
    idempotencyKey,
    isMultiModelFollowUpSlot: false,
    mediaToolIntent: context.mediaToolIntent ?? null,
    mode: context.mode ?? 'chat',
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
    context: PersonalChatWorkToolingContext & {
      agentRunId?: string
      automationRunId?: string
      toolName: string
    }
    messages: unknown[]
    toolCallId: string
  },
): Promise<unknown> {
  'use step'

  const { agentRunId, automationRunId, toolName, ...toolingContext } = options.context
  const runNamespace = agentRunId
    ? `agent-run:${agentRunId}`
    : `automation-run:${automationRunId ?? 'unknown'}`
  const logicalStepId = options.toolCallId || getStepMetadata().stepId
  const idempotencyKey = `${runNamespace}:tool:${logicalStepId}`
  const tooling = await reconstructTooling(toolingContext, idempotencyKey)
  const definition = tooling.tools[toolName]
  if (!definition || typeof definition.execute !== 'function') {
    throw new Error(`Tool ${toolName} is no longer available for this durable run.`)
  }
  return await definition.execute(input as never, {
    toolCallId: options.toolCallId,
    messages: options.messages,
    context: tooling.toolsContext?.[toolName],
    agentRunId,
    automationRunId,
    logicalStepId,
    idempotencyKey,
  } as never)
}

export async function personalChatWorkToolNeedsApproval(
  input: unknown,
  options: {
    context: PersonalChatWorkToolingContext & {
      agentRunId?: string
      automationRunId?: string
      toolName: string
    }
    messages: unknown[]
    toolCallId: string
  },
): Promise<boolean> {
  'use step'

  const { agentRunId: _agentRunId, automationRunId: _automationRunId, toolName, ...toolingContext } = options.context
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
