import { NextResponse } from 'next/server'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import { getOverlayServerContext } from '@/server/bootstrap'
import { agentEnvironmentErrorResponse } from '@/server/app-api/v1/agent-environments/shared'

export async function POST(_request: Request, context: AppApiRouteContext) {
  try {
    const body = context.parsedJson as Record<string, unknown>
    const conversationId = typeof body.conversationId === 'string' ? body.conversationId.trim() : ''
    const runId = typeof body.runId === 'string' ? body.runId.trim() : ''
    const requestKey = typeof body.requestKey === 'string' ? body.requestKey.trim() : ''
    const decision = typeof body.decision === 'string' ? body.decision.trim() : ''
    const response = body.response && typeof body.response === 'object' && !Array.isArray(body.response)
      ? body.response as Record<string, unknown> : undefined
    if (!conversationId || !runId || !requestKey || !decision) {
      return NextResponse.json({ error: 'conversationId, runId, requestKey, and decision are required' }, { status: 400 })
    }
    return NextResponse.json(await getOverlayServerContext().connectedAgentControlPlane.resolveRemoteRequest({
      actorUserId: context.auth.userId, workspaceId: context.workspace.workspace.id,
      conversationId, runId, requestKey, decision, ...(response ? { response } : {}),
    }))
  } catch (error) {
    return agentEnvironmentErrorResponse(error)
  }
}
