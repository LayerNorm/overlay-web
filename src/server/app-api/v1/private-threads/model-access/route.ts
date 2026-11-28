import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod/v3'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import { issuePrivateModelToken } from '@/server/private-threads/model-relay'
import { getOverlayServerContext } from '@/server/bootstrap'
import { privateThreadTier } from '@/server/mcp/private-thread-tools'
import { logger } from '@/server/observability/logger'

const NO_STORE = { 'Cache-Control': 'no-store' }

const bodySchema = z.object({
  workspaceId: z.string().min(1).max(256),
  agentId: z.string().min(1).max(256),
}).strict()

/**
 * Overlay Desktop asks for this before a private thread turn that runs on Overlay's models
 * (internal/develop/private-threads.md): a one-hour token for `/api/private-threads/model` naming this person,
 * workspace and agent. Paid workspaces only; the free tier uses the person's own keys and plans. Nothing about the
 * conversation is sent.
 */
export async function POST(_request: NextRequest, context: AppApiRouteContext) {
  try {
    const parsed = bodySchema.safeParse(context.parsedJson)
    if (!parsed.success) return NextResponse.json({ error: 'Choose a workspace and an agent.', code: 'invalid_request' }, { status: 400, headers: NO_STORE })
    const { workspaceId, agentId } = parsed.data
    const userId = context.auth.userId
    const server = getOverlayServerContext()
    const agent = await server.workspaceAgentService.get({ actorUserId: userId, workspaceId, agentId }).catch((_error) => null)
    if (!agent) return NextResponse.json({ error: 'Agent not found', code: 'not_found' }, { status: 404, headers: NO_STORE })
    if (await privateThreadTier({ userId, workspaceId }) !== 'paid') {
      return NextResponse.json({
        error: 'Overlay’s models in private threads need a paid workspace. Use your own key or plan instead.',
        code: 'paid_plan_required',
      }, { status: 402, headers: NO_STORE })
    }
    const issued = issuePrivateModelToken({ userId, workspaceId, agentId: agent.id })
    if (!issued) return NextResponse.json({ error: 'Overlay’s models are not configured on this server.', code: 'unavailable' }, { status: 503, headers: NO_STORE })
    return NextResponse.json(issued, { headers: NO_STORE })
  } catch (error) {
    logger.error('[private-thread-model] access failed', { error: error instanceof Error ? error.name : 'unknown' })
    return NextResponse.json({ error: 'Could not complete the request', code: 'internal_error' }, { status: 500, headers: NO_STORE })
  }
}
