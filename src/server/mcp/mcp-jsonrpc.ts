import 'server-only'

import { randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import { asSchema, type ToolSet } from '@/server/ai/sdk'
import { logger } from '@/server/observability/logger'

/**
 * MCP over Streamable HTTP, stateless, JSON responses (no SSE stream): the protocol
 * half shared by Overlay's two MCP servers (`/api/agent-mcp` for connected agents,
 * `/api/mcp` for outside AI apps). Callers authenticate first and hand in the tool
 * set; nothing here knows who is asking.
 */

export const SUPPORTED_MCP_PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05']

export type JsonRpcId = string | number | null
export type JsonRpcRequest = { jsonrpc?: string; id?: JsonRpcId; method?: string; params?: Record<string, unknown> }
export type JsonRpcResponse =
  | { jsonrpc: '2.0'; id: JsonRpcId; result: unknown }
  | { jsonrpc: '2.0'; id: JsonRpcId; error: { code: number; message: string } }

export const rpcError = (id: JsonRpcId, code: number, message: string): JsonRpcResponse => ({ jsonrpc: '2.0', id, error: { code, message } })
export const rpcResult = (id: JsonRpcId, result: unknown): JsonRpcResponse => ({ jsonrpc: '2.0', id, result })

export type McpToolSource = () => Promise<{ tools: ToolSet; instructions: string }>

function toolOutputText(output: unknown): string {
  return typeof output === 'string' ? output : JSON.stringify(output ?? null)
}

async function listTools(tools: ToolSet) {
  return await Promise.all(Object.entries(tools).map(async ([name, definition]) => ({
    name,
    description: definition.description ?? '',
    inputSchema: await asSchema(definition.inputSchema).jsonSchema,
  })))
}

async function callTool(tools: ToolSet, params: Record<string, unknown> | undefined, logContext: Record<string, unknown>) {
  const name = typeof params?.name === 'string' ? params.name : ''
  const definition = tools[name] as (ToolSet[string] & {
    execute?: (input: unknown, options: { toolCallId: string; messages: [] }) => unknown
  }) | undefined
  if (!definition?.execute) return { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true }
  const schema = asSchema(definition.inputSchema)
  let input: unknown = params?.arguments ?? {}
  if (schema.validate) {
    const validated = await schema.validate(input)
    if (!validated.success) {
      return { content: [{ type: 'text', text: `Invalid arguments for ${name}: ${validated.error.message}` }], isError: true }
    }
    input = validated.value
  }
  try {
    const output = await definition.execute(input, { toolCallId: `mcp_${randomUUID()}`, messages: [] })
    const failed = Boolean(output && typeof output === 'object' && (output as { success?: unknown }).success === false)
    return { content: [{ type: 'text', text: toolOutputText(output) }], ...(failed ? { isError: true } : {}) }
  } catch (error) {
    logger.warn('[mcp] tool failed', { ...logContext, tool: name, error: error instanceof Error ? error.message : String(error) })
    return { content: [{ type: 'text', text: error instanceof Error ? error.message : 'Tool failed' }], isError: true }
  }
}

async function handleMessage(
  message: JsonRpcRequest,
  context: { serverName: string; tools: McpToolSource; logContext: Record<string, unknown> },
): Promise<JsonRpcResponse | null> {
  const id = message.id ?? null
  const isNotification = message.id === undefined
  if (message.jsonrpc !== '2.0' || typeof message.method !== 'string') {
    return isNotification ? null : rpcError(id, -32600, 'Invalid request')
  }
  if (isNotification) return null
  switch (message.method) {
    case 'initialize': {
      const requested = typeof message.params?.protocolVersion === 'string' ? message.params.protocolVersion : ''
      const { instructions } = await context.tools()
      return rpcResult(id, {
        protocolVersion: SUPPORTED_MCP_PROTOCOL_VERSIONS.includes(requested) ? requested : SUPPORTED_MCP_PROTOCOL_VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: context.serverName, version: '1.0.0' },
        ...(instructions ? { instructions } : {}),
      })
    }
    case 'ping':
      return rpcResult(id, {})
    case 'tools/list':
      return rpcResult(id, { tools: await listTools((await context.tools()).tools) })
    case 'tools/call':
      return rpcResult(id, await callTool((await context.tools()).tools, message.params, context.logContext))
    default:
      return rpcError(id, -32601, `Method not found: ${message.method}`)
  }
}

/** Parses the request body and answers it (a batch gets a batch back, notifications get 202). */
export async function serveMcpJsonRpc(
  request: Request,
  options: { serverName: string; tools: McpToolSource; logContext?: Record<string, unknown> },
): Promise<Response> {
  let body: unknown
  try {
    body = await request.json()
  } catch (_error) {
    return NextResponse.json(rpcError(null, -32700, 'Parse error'), { status: 400 })
  }
  const messages = (Array.isArray(body) ? body : [body]) as JsonRpcRequest[]
  let toolsPromise: ReturnType<McpToolSource> | null = null
  const tools: McpToolSource = () => (toolsPromise ??= options.tools())
  const responses = (await Promise.all(messages.map((message) => handleMessage(message ?? {}, {
    serverName: options.serverName, tools, logContext: options.logContext ?? {},
  })))).filter((response): response is JsonRpcResponse => response !== null)
  if (responses.length === 0) return new Response(null, { status: 202 })
  return NextResponse.json(Array.isArray(body) ? responses : responses[0])
}
