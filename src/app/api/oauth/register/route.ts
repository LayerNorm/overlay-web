import { NextResponse, type NextRequest } from 'next/server'
import { mcpPreflight, withMcpCors } from '@/server/mcp/mcp-http'

/** Dynamic client registration (RFC 7591): an AI app tells Overlay where it wants to be sent back after consent. */
export async function POST(request: NextRequest) {
  const { handleMcpClientRegistration } = await import('@/server/mcp/oauth-endpoints')
  return withMcpCors(await handleMcpClientRegistration(request))
}

export async function OPTIONS() {
  return mcpPreflight()
}

export async function GET() {
  return withMcpCors(NextResponse.json({ error: 'invalid_request' }, { status: 405, headers: { Allow: 'POST, OPTIONS' } }))
}
