import { z } from 'zod'
import type { ChatMessage } from '../chat-service'
import { resolveOpenRouterModelId } from '../ai/gateway-provider'
import { openrouterChatService, type OpenRouterTool } from '../openrouter-chat-service'
import { createUnifiedTools } from './unified-tools'

export interface OpenRouterAgentEvent {
  type: 'step' | 'tool_start' | 'tool_result' | 'text' | 'error' | 'done' | 'max_steps_reached'
  step?: number
  maxSteps?: number
  stepsCompleted?: number
  tool?: string
  toolInput?: Record<string, unknown>
  toolResult?: string
  text?: string
  error?: string
}

export interface OpenRouterAgentResult {
  success: boolean
  text?: string
  error?: string
  usage: {
    inputTokens: number
    outputTokens: number
  }
}

const DEFAULT_MAX_STEPS = 20

type UnifiedToolDefinition = {
  description?: string
  inputSchema?: unknown
  execute?: ((input: unknown) => Promise<unknown>) | ((input: unknown) => unknown) | false
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isZodSchema(value: unknown): value is z.ZodTypeAny {
  return value instanceof z.ZodType
}

function extractJsonSchema(inputSchema: unknown): Record<string, unknown> | null {
  if (!inputSchema) return null

  if (isZodSchema(inputSchema)) {
    return z.toJSONSchema(inputSchema) as Record<string, unknown>
  }

  if (isRecord(inputSchema)) {
    const jsonSchema = inputSchema.jsonSchema
    if (isRecord(jsonSchema)) {
      return jsonSchema
    }

    if (
      'type' in inputSchema ||
      'properties' in inputSchema ||
      'additionalProperties' in inputSchema ||
      'required' in inputSchema
    ) {
      return inputSchema
    }
  }

  return null
}

function toOpenRouterTool(name: string, toolDef: UnifiedToolDefinition): OpenRouterTool {
  let parameters: Record<string, unknown> = {
    type: 'object',
    additionalProperties: true
  }

  if (toolDef.inputSchema) {
    try {
      const extractedSchema = extractJsonSchema(toolDef.inputSchema)
      if (extractedSchema) {
        parameters = extractedSchema
      } else {
        console.warn(
          `[OpenRouterAgent] Tool ${name} uses a non-serializable input schema; falling back to an open object schema`
        )
      }
    } catch (error) {
      console.warn(`[OpenRouterAgent] Failed to serialize schema for tool ${name}:`, error)
    }
  }

  return {
    type: 'function',
    function: {
      name,
      description: toolDef.description || `Execute tool ${name}`,
      parameters
    }
  }
}

function serializeToolResult(result: unknown): string {
  if (typeof result === 'string') return result
  if (result === undefined) return ''

  try {
    return JSON.stringify(result)
  } catch {
    return String(result)
  }
}

async function createOpenRouterToolsAndExecutors(
  command: string,
  securityTaskId: string
): Promise<{
  tools: OpenRouterTool[]
  executors: Record<string, (args: Record<string, unknown>) => Promise<string>>
}> {
  const unifiedTools = (await createUnifiedTools({
    surface: 'chat',
    securityTaskId,
    composio: {
      includeMetaTools: true,
      command
    }
  })) as Record<string, UnifiedToolDefinition>

  const tools = Object.entries(unifiedTools).map(([name, toolDef]) =>
    toOpenRouterTool(name, toolDef)
  )
  const executors: Record<string, (args: Record<string, unknown>) => Promise<string>> = {}

  for (const [name, toolDef] of Object.entries(unifiedTools)) {
    executors[name] = async (args) => {
      if (typeof toolDef.execute !== 'function') {
        return JSON.stringify({ success: false, error: `Tool ${name} is not executable` })
      }

      try {
        const parsedArgs =
          isZodSchema(toolDef.inputSchema) ||
          (isRecord(toolDef.inputSchema) && typeof toolDef.inputSchema.parse === 'function')
            ? (toolDef.inputSchema as { parse: (input: Record<string, unknown>) => unknown }).parse(
                args
              )
            : args
        const result = await toolDef.execute(parsedArgs)
        return serializeToolResult(result)
      } catch (error) {
        return JSON.stringify({
          success: false,
          error: error instanceof Error ? error.message : String(error)
        })
      }
    }
  }

  console.log(
    `[OpenRouterAgent] Available tools: ${tools.map((tool) => tool.function.name).join(', ')}`
  )
  return { tools, executors }
}

export async function runOpenRouterChatAgent(
  modelId: string,
  messages: ChatMessage[],
  command: string,
  onEvent: (event: OpenRouterAgentEvent) => void,
  isCancelled: () => boolean,
  securityTaskId: string,
  maxSteps = DEFAULT_MAX_STEPS
): Promise<OpenRouterAgentResult> {
  const resolvedModelId = resolveOpenRouterModelId(modelId)
  console.log(`[OpenRouterAgent] Starting chat agent with model: ${resolvedModelId}`)

  const { tools, executors } = await createOpenRouterToolsAndExecutors(command, securityTaskId)

  const result = await openrouterChatService.runAgentWithTools(
    resolvedModelId,
    messages,
    tools,
    executors,
    (event) => {
      switch (event.type) {
        case 'thinking':
          onEvent({ type: 'step', step: event.step, maxSteps })
          break
        case 'tool_start':
          onEvent({
            type: 'tool_start',
            step: event.step,
            tool: event.tool,
            toolInput: event.toolInput
          })
          break
        case 'tool_result':
          onEvent({
            type: 'tool_result',
            step: event.step,
            tool: event.tool,
            toolResult: event.toolResult
          })
          break
        case 'text':
          onEvent({ type: 'text', text: event.text })
          break
        case 'error':
          onEvent({ type: 'error', error: event.error })
          break
        case 'done':
          onEvent({ type: 'done' })
          break
        case 'max_steps_reached':
          onEvent({
            type: 'max_steps_reached',
            stepsCompleted: event.step,
            maxSteps,
            text: `The task is incomplete — the ${maxSteps}-step limit was reached. Reply "continue" to keep going.`
          })
          onEvent({ type: 'done' })
          break
      }
    },
    isCancelled,
    maxSteps
  )

  return {
    success: result.success,
    text: result.finalResponse,
    error: result.error,
    usage: {
      inputTokens: result.usage?.inputTokens || 0,
      outputTokens: result.usage?.outputTokens || 0
    }
  }
}
