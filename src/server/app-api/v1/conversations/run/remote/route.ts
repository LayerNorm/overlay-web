import { NextResponse } from 'next/server'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import { getOverlayServerContext } from '@/server/bootstrap'
import { agentEnvironmentErrorResponse } from '../../../agent-environments/shared'

export async function POST(_request: Request, context: AppApiRouteContext) {
  try {
    const body = context.parsedJson as Partial<{
      action: 'cancel' | 'retry'
      conversationId: string
      runId: string
    }>
    const action = body.action === 'cancel' || body.action === 'retry' ? body.action : null
    const conversationId = typeof body.conversationId === 'string' ? body.conversationId.trim() : ''
    const runId = typeof body.runId === 'string' ? body.runId.trim() : ''
    if (!action || !conversationId || !runId) {
      return NextResponse.json({ error: 'action, conversationId, and runId are required' }, { status: 400 })
    }
    const result = await getOverlayServerContext().connectedAgentControlPlane.controlQueuedRemoteTurn({
      actorUserId: context.auth.userId,
      workspaceId: context.workspace.workspace.id,
      conversationId,
      runId,
      action,
    })
    return NextResponse.json(result)
  } catch (error) {
    return agentEnvironmentErrorResponse(error)
  }
}
