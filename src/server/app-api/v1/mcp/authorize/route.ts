import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import { getOverlayServerContext } from '@/server/bootstrap'
import { McpOAuthError } from '@/server/mcp/McpAccessService'
import { mcpRouteError, NO_STORE } from '../shared'

const bodySchema = z.object({
  clientId: z.string().min(1).max(4096),
  redirectUri: z.string().min(1).max(1024),
  state: z.string().max(2048).optional(),
  decision: z.enum(['approve', 'deny']),
  workspaceId: z.string().min(1).max(256).optional(),
  access: z.string().max(16).optional(),
  codeChallenge: z.string().max(256).optional(),
}).strict()

/**
 * The person answers an AI app's request to connect (the consent page calls this).
 * Approving returns the redirect that carries a single-use code back to the app;
 * the code is bound to this person, workspace, and access level.
 */
export async function POST(_request: NextRequest, context: AppApiRouteContext) {
  try {
    const parsed = bodySchema.safeParse(context.parsedJson)
    if (!parsed.success) throw new McpOAuthError('invalid_request', 'The authorization request is incomplete.')
    const body = parsed.data
    const mcp = getOverlayServerContext().mcpAccess
    if (body.decision === 'deny') {
      return NextResponse.json(mcp.denyAuthorization({ clientId: body.clientId, redirectUri: body.redirectUri, ...(body.state ? { state: body.state } : {}) }), { headers: NO_STORE })
    }
    if (!body.workspaceId || !body.codeChallenge) throw new McpOAuthError('invalid_request', 'Choose a workspace to share.')
    const result = await mcp.approveAuthorization({
      userId: context.auth.userId, workspaceId: body.workspaceId, access: body.access, clientId: body.clientId,
      redirectUri: body.redirectUri, codeChallenge: body.codeChallenge, ...(body.state ? { state: body.state } : {}),
    })
    return NextResponse.json(result, { headers: NO_STORE })
  } catch (error) {
    return mcpRouteError(error)
  }
}
