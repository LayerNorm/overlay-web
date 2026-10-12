import 'server-only'

import { NextResponse, type NextRequest } from 'next/server'
import type { ToolSet } from '@/server/ai/sdk'
import { getOverlayServerContext } from '@/server/bootstrap'
import { enforceRateLimits } from '@/server/security/rate-limit'
import { getClientIp } from '@/server/security/rate-limit'
import { buildOverlayMcpTools } from './external-mcp-tools'
import type { McpPrincipal } from './McpAccessService'
import { rpcError, serveMcpJsonRpc, type McpPromptSource } from './mcp-jsonrpc'
import { overlaySkillPrompts } from './skill-prompts'
import { mcpBaseUrl, mcpUrls, withMcpCors } from './mcp-http'

/**
 * Overlay's MCP server for outside AI apps (ChatGPT, Claude on the web or desktop,
 * Cursor, Claude Code, Codex…): the person's Overlay workspace as tools, at the
 * access level they chose when they connected the app. Stateless MCP Streamable
 * HTTP with JSON responses; the bearer is an OAuth access token or a personal
 * token, resolved to a revocable grant on every request.
 */

const TEN_MINUTES = 10 * 60_000

export type OverlayMcpDependencies = {
  authenticate: (bearer: string | null) => Promise<McpPrincipal | null>
  buildTools: (principal: McpPrincipal) => Promise<{ tools: ToolSet; instructions: string }>
  /** The person's skills as prompts. Every access level can read them, since a prompt only offers text. */
  buildPrompts?: (principal: McpPrincipal) => McpPromptSource
}

const defaultDependencies: OverlayMcpDependencies = {
  authenticate: (bearer) => getOverlayServerContext().mcpAccess.authenticate(bearer),
  buildTools: buildOverlayMcpTools,
  buildPrompts: (principal) => overlaySkillPrompts({ userId: principal.userId, workspaceId: principal.workspaceId }),
}

function bearer(request: Request): string | null {
  const header = request.headers.get('authorization') ?? ''
  return header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : null
}

function unauthorized(request: Request, presented: boolean): Response {
  // The resource-metadata pointer is how an OAuth-capable client finds where to sign in.
  const challenge = `Bearer realm="overlay", resource_metadata="${mcpUrls(mcpBaseUrl(request)).resourceMetadata}"${presented ? ', error="invalid_token"' : ''}`
  return NextResponse.json(rpcError(null, -32001, presented ? 'Invalid, expired, or revoked token' : 'Authorization required'), {
    status: 401,
    headers: { 'WWW-Authenticate': challenge },
  })
}

export async function handleOverlayMcpRequest(
  request: NextRequest,
  dependencies: OverlayMcpDependencies = defaultDependencies,
): Promise<Response> {
  const token = bearer(request)
  const principal = token ? await dependencies.authenticate(token) : null
  if (!principal) return withMcpCors(unauthorized(request, Boolean(token)))

  const limited = await enforceRateLimits(request, [
    { bucket: 'mcp:grant', key: principal.grantId, limit: 600, windowMs: TEN_MINUTES },
    // Hosted apps share egress IPs across all their users; the grant is the real limit.
    { bucket: 'mcp:ip', key: getClientIp(request), limit: 12_000, windowMs: TEN_MINUTES },
  ])
  if (limited) return withMcpCors(limited)

  const response = await serveMcpJsonRpc(request, {
    serverName: 'overlay',
    tools: () => dependencies.buildTools(principal),
    ...(dependencies.buildPrompts ? { prompts: dependencies.buildPrompts(principal) } : {}),
    logContext: { grantId: principal.grantId, client: principal.clientName },
  })
  return withMcpCors(response)
}
