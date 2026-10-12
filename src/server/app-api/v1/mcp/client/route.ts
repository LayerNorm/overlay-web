import { NextResponse, type NextRequest } from 'next/server'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import { getOverlayServerContext } from '@/server/bootstrap'
import { McpOAuthError } from '@/server/mcp/McpAccessService'
import { mcpRouteError, NO_STORE } from '../shared'

/** What the consent page shows about the app asking to connect: its name and where it will be sent back. */
export async function GET(request: NextRequest, _context: AppApiRouteContext) {
  try {
    const clientId = request.nextUrl.searchParams.get('clientId') ?? ''
    const redirectUri = request.nextUrl.searchParams.get('redirectUri') ?? ''
    const client = getOverlayServerContext().mcpAccess.describeClient(clientId)
    if (!client || !client.redirectUris.includes(redirectUri)) {
      throw new McpOAuthError('invalid_request', 'This app is not registered, or the redirect does not match.')
    }
    return NextResponse.json({ name: client.name, redirectHost: redirectHost(redirectUri) }, { headers: NO_STORE })
  } catch (error) {
    return mcpRouteError(error)
  }
}

function redirectHost(uri: string): string {
  try {
    const url = new URL(uri)
    return url.host || `${url.protocol}//`
  } catch (_error) {
    return ''
  }
}
