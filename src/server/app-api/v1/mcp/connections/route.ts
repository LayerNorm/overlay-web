import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import { getOverlayServerContext } from '@/server/bootstrap'
import { McpOAuthError } from '@/server/mcp/McpAccessService'
import { mcpBaseUrl, mcpUrls } from '@/server/mcp/mcp-http'
import { mcpRouteError, NO_STORE } from '../shared'

const GRANT_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/

const createSchema = z.object({
  name: z.string().max(80).optional(),
  workspaceId: z.string().min(1).max(256),
  access: z.string().max(16),
  ttlDays: z.number().int().min(1).max(365).optional(),
}).strict()

/** The apps and tokens the person has connected to Overlay's MCP server, and the server's address. */
export async function GET(request: NextRequest, context: AppApiRouteContext) {
  try {
    const grants = await getOverlayServerContext().mcpAccess.list(context.auth.userId)
    return NextResponse.json({
      endpoint: mcpUrls(mcpBaseUrl(request)).resource,
      data: grants.map((grant) => ({
        id: grant.id, name: grant.clientName, kind: grant.kind, access: grant.access, workspaceId: grant.workspaceId,
        createdAt: grant.createdAt, lastUsedAt: grant.lastUsedAt ?? null, expiresAt: grant.expiresAt ?? null,
      })),
    }, { headers: NO_STORE })
  } catch (error) {
    return mcpRouteError(error)
  }
}

/** Create a personal token for a local agent that does not do OAuth. The token is in this response only. */
export async function POST(request: NextRequest, context: AppApiRouteContext) {
  try {
    const parsed = createSchema.safeParse(context.parsedJson)
    if (!parsed.success) throw new McpOAuthError('invalid_request', 'Choose a workspace and what the token can do.')
    const { token, grant } = await getOverlayServerContext().mcpAccess.createPersonalToken({
      userId: context.auth.userId, workspaceId: parsed.data.workspaceId, access: parsed.data.access,
      name: parsed.data.name, ...(parsed.data.ttlDays ? { ttlDays: parsed.data.ttlDays } : {}),
    })
    return NextResponse.json({ token, endpoint: mcpUrls(mcpBaseUrl(request)).resource, connection: { id: grant.id, name: grant.clientName, access: grant.access, workspaceId: grant.workspaceId, expiresAt: grant.expiresAt ?? null } }, { status: 201, headers: NO_STORE })
  } catch (error) {
    return mcpRouteError(error)
  }
}

/** Disconnect an app or revoke a token. Its credentials stop working immediately. */
export async function DELETE(request: NextRequest, context: AppApiRouteContext) {
  try {
    const id = request.nextUrl.searchParams.get('id')
    if (!id || !GRANT_ID_PATTERN.test(id)) throw new McpOAuthError('invalid_request', 'Choose a connection to remove.')
    const revoked = await getOverlayServerContext().mcpAccess.revoke(context.auth.userId, id)
    if (!revoked) return NextResponse.json({ error: 'Connection not found', code: 'not_found' }, { status: 404, headers: NO_STORE })
    return NextResponse.json({ ok: true }, { headers: NO_STORE })
  } catch (error) {
    return mcpRouteError(error)
  }
}
