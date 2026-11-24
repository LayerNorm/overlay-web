import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod/v3'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import { getOverlayServerContext } from '@/server/bootstrap'
import { McpOAuthError } from '@/server/mcp/McpAccessService'
import { mcpBaseUrl, mcpUrls } from '@/server/mcp/mcp-http'
import { privateThreadTier } from '@/server/mcp/private-thread-tools'
import { mcpRouteError, NO_STORE } from '../shared'

const bodySchema = z.object({
  workspaceId: z.string().min(1).max(256),
  agentId: z.string().min(1).max(256),
}).strict()

/**
 * Overlay Desktop asks for this before each private thread turn (internal/develop/private-threads.md): a short-lived
 * token for `/api/mcp` that carries this person, workspace and agent, so the Agent Host on the computer can call the
 * agent's Overlay tools. Nothing about the conversation is sent. `tier` tells the desktop which tools to expect.
 */
export async function POST(request: NextRequest, context: AppApiRouteContext) {
  try {
    const parsed = bodySchema.safeParse(context.parsedJson)
    if (!parsed.success) throw new McpOAuthError('invalid_request', 'Choose a workspace and an agent.')
    const { workspaceId, agentId } = parsed.data
    const userId = context.auth.userId
    const server = getOverlayServerContext()
    const agent = await server.workspaceAgentService.get({ actorUserId: userId, workspaceId, agentId }).catch((_error) => null)
    if (!agent) return NextResponse.json({ error: 'Agent not found', code: 'not_found' }, { status: 404, headers: NO_STORE })
    const [{ token, expiresAt }, tier] = await Promise.all([
      server.mcpAccess.issuePrivateThreadToken({ userId, workspaceId, agentId: agent.id }),
      privateThreadTier({ userId, workspaceId }),
    ])
    return NextResponse.json({ url: mcpUrls(mcpBaseUrl(request)).resource, token, expiresAt, tier }, { headers: NO_STORE })
  } catch (error) {
    return mcpRouteError(error)
  }
}
