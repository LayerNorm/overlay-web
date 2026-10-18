import type { NextRequest } from 'next/server'

export const maxDuration = 300

/**
 * Overlay MCP server for connected agents. Auth is the per-turn agent MCP
 * bearer token the Agent Host receives with each remote turn, not the session
 * cookie — deliberately outside the BFF wrapper, like the agent gateway.
 */
export async function POST(request: NextRequest) {
  const { handleAgentMcpRequest } = await import('@/server/agents/agent-mcp-server')
  return handleAgentMcpRequest(request)
}

/** New hosts resume the same unfinished tool call using its SSE event cursor. */
export async function GET(request: NextRequest) {
  const { handleAgentMcpRequest } = await import('@/server/agents/agent-mcp-server')
  return handleAgentMcpRequest(request)
}

export async function DELETE() {
  return new Response(null, { status: 405, headers: { Allow: 'POST' } })
}
