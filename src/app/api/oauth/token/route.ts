import { NextResponse, type NextRequest } from 'next/server'
import { mcpPreflight, withMcpCors } from '@/server/mcp/mcp-http'

/** OAuth token endpoint for AI apps connected to Overlay's MCP server: authorization code and refresh. */
export async function POST(request: NextRequest) {
  const { handleMcpTokenRequest } = await import('@/server/mcp/oauth-endpoints')
  return withMcpCors(await handleMcpTokenRequest(request))
}

export async function OPTIONS() {
  return mcpPreflight()
}

export async function GET() {
  return withMcpCors(NextResponse.json({ error: 'invalid_request' }, { status: 405, headers: { Allow: 'POST, OPTIONS' } }))
}
