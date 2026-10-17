import 'server-only'

import { NextResponse, type NextRequest } from 'next/server'
import type { ToolSet } from '@/server/ai/sdk'
import { getOverlayServerContext } from '@/server/bootstrap'
import { rpcError, serveMcpJsonRpc, type McpPromptSource } from '@/server/mcp/mcp-jsonrpc'
import { overlaySkillPrompts } from '@/server/mcp/skill-prompts'
import { verifyAgentMcpToken, type AgentMcpTokenClaims } from './agent-mcp-token'
import { buildAgentMcpTools } from './agent-mcp-tools'
import { agentMcpSessionIsLive } from '@/shared/agents/agent-mcp-authority'
import { createMcpCallJournal, type McpCallRecord } from './McpCallJournal'
import { serveDurableAgentMcp, type DurableMcpToolHooks } from './agent-mcp-resumption'
import { createDurableMcpApprovalGate } from './mcp-approval-gate'

/**
 * Overlay's MCP server for connected agents (Claude Code, Codex, Hermes… on a
 * user's own machine through the Agent Host). It serves the same Overlay
 * workspace tools a native Overlay agent gets — notes, files, memory,
 * knowledge, automations, connected apps — over MCP Streamable HTTP.
 *
 * Every request carries the per-turn bearer token. New hosts use a durable
 * tool-call journal and resumable SSE; older hosts retain plain JSON responses.
 */

async function isCurrentMcpRunLive(claims: AgentMcpTokenClaims): Promise<boolean> {
  const session = await getOverlayServerContext().appData.repositories.connectedAgents.getRemoteSessionForRun({
    workspaceId: claims.workspaceId, environmentId: claims.environmentId, runId: claims.runId,
  }).catch((_error) => null)
  return agentMcpSessionIsLive(claims, session)
}

export type AgentMcpDependencies = {
  verifyToken: (token: string | null) => AgentMcpTokenClaims | null
  isRunLive: (claims: AgentMcpTokenClaims) => Promise<boolean>
  buildTools: (claims: AgentMcpTokenClaims, hooks?: DurableMcpToolHooks) => Promise<{ tools: ToolSet; instructions: string }>
  createJournal?: typeof createMcpCallJournal
  requestApproval?: (claims: AgentMcpTokenClaims, call: McpCallRecord, tool: string, input: unknown) => Promise<{ allowed: true } | { allowed: false; message: string }>
  /** Overlay skills as prompts, for agents granted the skills group. */
  buildPrompts?: (claims: AgentMcpTokenClaims) => McpPromptSource | null
}

const defaultDependencies: AgentMcpDependencies = {
  verifyToken: verifyAgentMcpToken,
  buildPrompts: (claims) => (claims.grant.isDefaultMaster || claims.grant.allowedToolIds.includes('list_skills')
    ? overlaySkillPrompts({ userId: claims.userId, workspaceId: claims.workspaceId })
    : null),
  isRunLive: isCurrentMcpRunLive,
  createJournal: createMcpCallJournal,
  requestApproval: (claims, call, tool, input) => createDurableMcpApprovalGate({
    repository: getOverlayServerContext().appData.repositories.connectedAgents,
    authority: { workspaceId: claims.workspaceId, environmentId: claims.environmentId, runId: claims.runId,
      sessionId: claims.sessionId, execution: claims.execution, expiresAt: claims.expiresAt, requestKey: call.requestKey },
    authorize: () => isCurrentMcpRunLive(claims),
  })(tool, input),
  buildTools: (claims, hooks) => buildAgentMcpTools({
    actorUserId: claims.userId,
    agentId: claims.agentId,
    agentPrincipalId: claims.agentPrincipalId,
    conversationId: claims.conversationId,
    invocationNonce: claims.invocationNonce,
    ...(claims.latestUserText ? { latestUserText: claims.latestUserText } : {}),
    memoryEnabled: claims.memoryEnabled,
    modelId: claims.modelId,
    toolGrant: claims.grant,
    run: { environmentId: claims.environmentId, runId: claims.runId,
      ...(claims.sessionId ? { sessionId: claims.sessionId } : {}),
      ...(claims.execution ? { execution: claims.execution } : {}), expiresAt: claims.expiresAt },
    turnId: claims.turnId,
    workspaceId: claims.workspaceId,
    authorize: () => isCurrentMcpRunLive(claims),
    resumable: claims.approvalBridge,
    ...(hooks ? { durableCall: hooks } : {}),
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
  const token = bearer(request)
  const claims = dependencies.verifyToken(token)
  if (!claims) {
    return NextResponse.json(rpcError(null, -32001, 'Invalid or expired Overlay MCP token'), {
      status: 401,
      headers: { 'WWW-Authenticate': 'Bearer' },
    })
  }
  if (!(await dependencies.isRunLive(claims))) {
    return NextResponse.json(rpcError(null, -32001, 'This agent run has ended'), { status: 401 })
  }

  const ordinary = (request: Request) => serveMcpJsonRpc(request, {
    serverName: 'overlay',
    tools: () => dependencies.buildTools(claims),
    ...(() => { const prompts = dependencies.buildPrompts?.(claims); return prompts ? { prompts } : {} })(),
    logContext: { agentId: claims.agentId, runId: claims.runId },
  })
  if (claims.approvalBridge && claims.sessionId && token) {
    const requestApproval = dependencies.requestApproval
    if (!dependencies.createJournal || !requestApproval) return Response.json(rpcError(null, -32000, 'MCP resumption unavailable'), { status: 503 })
    return serveDurableAgentMcp(request, { token, journal: dependencies.createJournal(claims),
      authorize: () => dependencies.isRunLive(claims), tools: hooks => dependencies.buildTools(claims, hooks),
      requestApproval: (call, tool, input) => requestApproval(claims, call, tool, input), ordinary })
  }
  if (request.method !== 'POST') return new Response(null, { status: 405, headers: { Allow: 'POST' } })
  return ordinary(request)
}
