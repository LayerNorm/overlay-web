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

/** Stateless server: no server-initiated SSE stream and no sessions to end. */
export async function GET() {
  return new Response(null, { status: 405, headers: { Allow: 'POST' } })
}

export async function DELETE() {
  return new Response(null, { status: 405, headers: { Allow: 'POST' } })
}
