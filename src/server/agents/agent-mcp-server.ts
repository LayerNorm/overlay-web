import 'server-only'

import { NextResponse, type NextRequest } from 'next/server'
import type { ToolSet } from '@/server/ai/sdk'
import { getOverlayServerContext } from '@/server/bootstrap'
import { rpcError, serveMcpJsonRpc } from '@/server/mcp/mcp-jsonrpc'
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

const LIVE_SESSION_STATUSES = new Set(['starting', 'running', 'waiting_for_approval', 'waiting_for_input', 'recovering'])

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

  return serveMcpJsonRpc(request, {
    serverName: 'overlay',
    tools: () => dependencies.buildTools(claims),
    logContext: { agentId: claims.agentId, runId: claims.runId },
  })
}
