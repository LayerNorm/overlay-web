import { connection } from 'next/server'
import { mcpPreflight } from '@/server/mcp/mcp-http'

/** RFC 9728 metadata for the MCP endpoint: which authorization server issues tokens for it. */
export async function GET() {
  // Built from the configured app URL at request time, never baked in at build.
  await connection()
  const { protectedResourceMetadata } = await import('@/server/mcp/oauth-endpoints')
  return protectedResourceMetadata()
}

export async function OPTIONS() {
  return mcpPreflight()
}
