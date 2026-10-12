import type { NextRequest } from 'next/server'
import { mcpPreflight, withMcpCors } from '@/server/mcp/mcp-http'

export const maxDuration = 300

/**
 * Overlay's MCP server for outside AI apps. Auth is an OAuth access token or personal
 * token the person granted, not the session cookie, so it sits outside the BFF
 * wrapper like `/api/agent-mcp`.
 */
export async function POST(request: NextRequest) {
  const { handleOverlayMcpRequest } = await import('@/server/mcp/overlay-mcp-server')
  return handleOverlayMcpRequest(request)
}

/** Stateless server: no server-initiated SSE stream and no sessions to end. */
export async function GET() {
  return withMcpCors(new Response(null, { status: 405, headers: { Allow: 'POST, OPTIONS' } }))
}

export async function DELETE() {
  return withMcpCors(new Response(null, { status: 405, headers: { Allow: 'POST, OPTIONS' } }))
}

export async function OPTIONS() {
  return mcpPreflight()
}
