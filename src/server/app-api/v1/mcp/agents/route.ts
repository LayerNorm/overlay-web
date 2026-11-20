import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod/v3'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import { getOverlayServerContext } from '@/server/bootstrap'
import { McpAgentNetworkError } from '@/server/mcp/agent-network/McpAgentNetworkService'
import { mcpRouteError, NO_STORE } from '../shared'

const actionSchema = z.object({
  id: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
  action: z.enum(['approve', 'decline', 'pause', 'resume', 'remove']),
}).strict()

function failure(error: unknown): Response {
  if (error instanceof McpAgentNetworkError) {
    return NextResponse.json({ error: error.message, code: error.code }, { status: error.statusCode, headers: NO_STORE })
  }
  return mcpRouteError(error)
}

/** Outside agents in the current workspace: those that joined over MCP, and the requests waiting for an admin. */
export async function GET(_request: NextRequest, context: AppApiRouteContext) {
  try {
    const result = await getOverlayServerContext().mcpAgentNetwork.listForWorkspace({
      actorUserId: context.auth.userId, workspaceId: context.workspace.workspace.id,
    })
    return NextResponse.json(result, { headers: NO_STORE })
  } catch (error) {
    return failure(error)
  }
}

/** Approve or decline a request to join (admins), or pause, resume, or remove an agent (its owner or an admin). */
export async function POST(_request: NextRequest, context: AppApiRouteContext) {
  try {
    const parsed = actionSchema.safeParse(context.parsedJson)
    if (!parsed.success) throw new McpAgentNetworkError('Choose an agent and what to do.', 400, 'validation')
    const network = getOverlayServerContext().mcpAgentNetwork
    const base = { actorUserId: context.auth.userId, workspaceId: context.workspace.workspace.id, joinId: parsed.data.id }
    const { action } = parsed.data
    if (action === 'approve' || action === 'decline') await network.decide({ ...base, decision: action })
    else await network.update({ ...base, action })
    return NextResponse.json({ ok: true }, { headers: NO_STORE })
  } catch (error) {
    return failure(error)
  }
}
