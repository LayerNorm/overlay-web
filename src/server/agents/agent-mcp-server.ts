import 'server-only'

import { randomUUID } from 'node:crypto'
import { NextResponse, type NextRequest } from 'next/server'
import { asSchema, type ToolSet } from '@/server/ai/sdk'
import { getOverlayServerContext } from '@/server/bootstrap'
import { logger } from '@/server/observability/logger'
import { verifyAgentMcpToken, type AgentMcpTokenClaims } from './agent-mcp-token'
import { buildAgentMcpTools } from './agent-mcp-tools'

/**
 * Overlay's MCP server for connected agents (Claude Code, Codex, Hermes… on a
 * user's own machine through the Agent Host). It serves the same Overlay
 * workspace tools a native Overlay agent gets — notes, files, memory,
 * knowledge, automations, connected apps — over MCP Streamable HTTP.
 *
 * Stateless: every POST carries the per-turn bearer token, the tool set is
 * rebuilt from its grant, and responses are plain JSON (no SSE stream).
 */

const SUPPORTED_PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05']
const LIVE_SESSION_STATUSES = new Set(['starting', 'running', 'waiting_for_approval', 'waiting_for_input', 'recovering'])

type JsonRpcId = string | number | null
type JsonRpcRequest = { jsonrpc?: string; id?: JsonRpcId; method?: string; params?: Record<string, unknown> }
type JsonRpcResponse =
  | { jsonrpc: '2.0'; id: JsonRpcId; result: unknown }
  | { jsonrpc: '2.0'; id: JsonRpcId; error: { code: number; message: string } }

const rpcError = (id: JsonRpcId, code: number, message: string): JsonRpcResponse => ({ jsonrpc: '2.0', id, error: { code, message } })
const rpcResult = (id: JsonRpcId, result: unknown): JsonRpcResponse => ({ jsonrpc: '2.0', id, result })

export type AgentMcpDependencies = {
  verifyToken: (token: string | null) => AgentMcpTokenClaims | null
  isRunLive: (claims: AgentMcpTokenClaims) => Promise<boolean>
  buildTools: (claims: AgentMcpTokenClaims) => Promise<{ tools: ToolSet; instructions: string }>
}

const defaultDependencies: AgentMcpDependencies = {
  verifyToken: verifyAgentMcpToken,
  async isRunLive(claims) {
    const session = await getOverlayServerContext().appData.repositories.connectedAgents.getRemoteSessionForRun({
      workspaceId: claims.workspaceId,
      environmentId: claims.environmentId,
      runId: claims.runId,
    }).catch((_error) => null)
    return Boolean(session && LIVE_SESSION_STATUSES.has(session.status))
  },
  buildTools: (claims) => buildAgentMcpTools({
    actorUserId: claims.userId,
    agentId: claims.agentId,
    agentPrincipalId: claims.agentPrincipalId,
    conversationId: claims.conversationId,
    invocationNonce: claims.invocationNonce,
    ...(claims.latestUserText ? { latestUserText: claims.latestUserText } : {}),
    memoryEnabled: claims.memoryEnabled,
    modelId: claims.modelId,
    toolGrant: claims.grant,
    turnId: claims.turnId,
    workspaceId: claims.workspaceId,
  }),
}

function bearer(request: Request): string | null {
  const header = request.headers.get('authorization') ?? ''
  return header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : null
}

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

async function callTool(tools: ToolSet, params: Record<string, unknown> | undefined, claims: AgentMcpTokenClaims) {
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
    logger.warn('[agent-mcp] tool failed', {
      agentId: claims.agentId,
      runId: claims.runId,
      tool: name,
      error: error instanceof Error ? error.message : String(error),
    })
    return { content: [{ type: 'text', text: error instanceof Error ? error.message : 'Tool failed' }], isError: true }
  }
}

async function handleMessage(
  message: JsonRpcRequest,
  context: { claims: AgentMcpTokenClaims; tools: () => Promise<{ tools: ToolSet; instructions: string }> },
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
        protocolVersion: SUPPORTED_PROTOCOL_VERSIONS.includes(requested) ? requested : SUPPORTED_PROTOCOL_VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'overlay', version: '1.0.0' },
        ...(instructions ? { instructions } : {}),
      })
    }
    case 'ping':
      return rpcResult(id, {})
    case 'tools/list':
      return rpcResult(id, { tools: await listTools((await context.tools()).tools) })
    case 'tools/call':
      return rpcResult(id, await callTool((await context.tools()).tools, message.params, context.claims))
    default:
      return rpcError(id, -32601, `Method not found: ${message.method}`)
  }
}

export async function handleAgentMcpRequest(
  request: NextRequest | Request,
  dependencies: AgentMcpDependencies = defaultDependencies,
): Promise<Response> {
  const claims = dependencies.verifyToken(bearer(request))
  if (!claims) {
    return NextResponse.json(rpcError(null, -32001, 'Invalid or expired Overlay MCP token'), {
      status: 401,
      headers: { 'WWW-Authenticate': 'Bearer' },
    })
  }
  if (!(await dependencies.isRunLive(claims))) {
    return NextResponse.json(rpcError(null, -32001, 'This agent run has ended'), { status: 401 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch (_error) {
    return NextResponse.json(rpcError(null, -32700, 'Parse error'), { status: 400 })
  }
  const messages = (Array.isArray(body) ? body : [body]) as JsonRpcRequest[]
  let toolsPromise: Promise<{ tools: ToolSet; instructions: string }> | null = null
  const tools = () => (toolsPromise ??= dependencies.buildTools(claims))
  const responses = (await Promise.all(messages.map((message) => handleMessage(message ?? {}, { claims, tools }))))
    .filter((response): response is JsonRpcResponse => response !== null)
  if (responses.length === 0) return new Response(null, { status: 202 })
  return NextResponse.json(Array.isArray(body) ? responses : responses[0])
}
