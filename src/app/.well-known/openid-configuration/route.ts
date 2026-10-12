import { connection } from 'next/server'
import { mcpPreflight } from '@/server/mcp/mcp-http'

/** RFC 8414 authorization server metadata: where AI apps register, send the person to consent, and exchange codes. */
export async function GET(request: Request) {
  // Built from the configured app URL at request time, never baked in at build.
  await connection()
  const { authorizationServerMetadata } = await import('@/server/mcp/oauth-endpoints')
  return authorizationServerMetadata(request)
}

export async function OPTIONS() {
  return mcpPreflight()
}
