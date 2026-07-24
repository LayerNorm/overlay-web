import type { ToolCostBucket } from './buckets'

export type ToolCategory =
  | 'automation'
  | 'billing'
  | 'browser'
  | 'developer'
  | 'file'
  | 'integration'
  | 'internal'
  | 'knowledge'
  | 'media'
  | 'memory'
  | 'notes'
  | (string & {})

export type ToolRisk = 'low' | 'medium' | 'high'

export type ToolSource = 'browser' | 'composio' | 'internal' | 'mcp' | 'overlay' | (string & {})

export interface ToolExecutionContext {
  userId?: string
  accessToken?: string
  conversationId?: string
  turnId?: string
  projectId?: string
  metadata?: Record<string, unknown>
}

export interface ToolDefinition<TInput = unknown, TOutput = unknown, TContext = ToolExecutionContext> {
  id: string
  name?: string
  label?: string
  description?: string
  category?: ToolCategory
  source?: ToolSource
  costBucket?: ToolCostBucket
  risk?: ToolRisk
  inputSchema?: unknown
  outputSchema?: unknown
  metadata?: Record<string, unknown>
  execute?: (input: TInput, context: TContext) => TOutput | Promise<TOutput>
}

export interface ToolCall<TInput = unknown> {
  id?: string
  toolId: string
  input: TInput
}

export interface ToolResult<TOutput = unknown> {
  toolId: string
  output: TOutput
  metadata?: Record<string, unknown>
}
