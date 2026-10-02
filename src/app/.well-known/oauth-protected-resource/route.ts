import { connection } from 'next/server'
import { mcpPreflight } from '@/server/mcp/mcp-http'

/** Same metadata at the root, for clients that do not use the path-suffixed form. */
export async function GET(request: Request) {
  // Built from the configured app URL at request time, never baked in at build.
  await connection()
  const { protectedResourceMetadata } = await import('@/server/mcp/oauth-endpoints')
  return protectedResourceMetadata(request)
}

export async function OPTIONS() {
  return mcpPreflight()
}
