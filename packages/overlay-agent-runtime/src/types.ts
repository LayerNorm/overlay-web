import type { LLMGateway } from '@overlay/llm-gateway'
import type { ToolDefinition, ToolResult } from '@overlay/tools-core'

export type AgentMessageRole = 'assistant' | 'system' | 'tool' | 'user'

export interface AgentMessagePart {
  type: string
  text?: string
  data?: unknown
}

export interface AgentMessage {
  id?: string
  role: AgentMessageRole
  content: string | AgentMessagePart[]
  metadata?: Record<string, unknown>
}

export interface AgentTurnInput {
  userId: string
  turnId: string
  conversationId?: string
  modelId?: string
  latestUserText?: string
  messages?: AgentMessage[]
  allowedToolIds?: readonly string[]
  metadata?: Record<string, unknown>
}

export interface AgentRuntimeContext {
  systemContext?: string
  resources?: Record<string, unknown>
  metadata?: Record<string, unknown>
}

export interface AgentToolCallRecord {
  id?: string
  toolId: string
  input?: unknown
  output?: unknown
  error?: string
  metadata?: Record<string, unknown>
}

export interface AgentTurnExecution {
  text: string
  messages?: AgentMessage[]
  parts?: AgentMessagePart[]
  toolCalls?: AgentToolCallRecord[]
  toolResults?: ToolResult[]
  usage?: {
    inputTokens?: number
    outputTokens?: number
    totalTokens?: number
  }
  metadata?: Record<string, unknown>
}

export interface AgentTurnOutput extends AgentTurnExecution {
  context: AgentRuntimeContext
  persisted: boolean
}

export interface ToolRegistryLike {
  list(): readonly ToolDefinition[]
  execute(args: {
    toolId: string
    input: unknown
    context?: unknown
    allowedToolIds?: readonly string[] | ReadonlySet<string> | null
  }): Promise<ToolResult>
}

export interface AgentContextBuilder {
  build(args: {
    input: AgentTurnInput
    tools: readonly ToolDefinition[]
    llmGateway?: LLMGateway
  }): Promise<AgentRuntimeContext>
}

export interface AgentTurnPersistence {
  persist(args: {
    input: AgentTurnInput
    output: AgentTurnOutput
    context: AgentRuntimeContext
  }): Promise<void>
}

export type AgentTurnExecutor = (args: {
  input: AgentTurnInput
  context: AgentRuntimeContext
  tools: readonly ToolDefinition[]
  toolRegistry: ToolRegistryLike
  llmGateway?: LLMGateway
}) => Promise<AgentTurnExecution>

export interface AgentRuntimeDeps {
  tools?: ToolRegistryLike | readonly ToolDefinition[]
  contextBuilder?: AgentContextBuilder
  persistTurn?: AgentTurnPersistence
  executeTurn?: AgentTurnExecutor
  llmGateway?: LLMGateway
}
