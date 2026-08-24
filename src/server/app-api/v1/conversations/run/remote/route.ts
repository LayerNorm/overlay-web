import { NextResponse } from 'next/server'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import { getOverlayServerContext } from '@/server/bootstrap'
import { agentEnvironmentErrorResponse } from '../../../agent-environments/shared'

export async function POST(_request: Request, context: AppApiRouteContext) {
  try {
    const body = context.parsedJson as Partial<{
      action: 'cancel' | 'retry' | 'resume' | 'start_fresh'
      conversationId: string
      runId: string
    }>
    const action = ['cancel', 'retry', 'resume', 'start_fresh'].includes(String(body.action)) ? body.action : null
    const conversationId = typeof body.conversationId === 'string' ? body.conversationId.trim() : ''
    const runId = typeof body.runId === 'string' ? body.runId.trim() : ''
    if (!action || !conversationId || !runId) {
      return NextResponse.json({ error: 'action, conversationId, and runId are required' }, { status: 400 })
    }
    const result = await getOverlayServerContext().connectedAgentControlPlane.controlRemoteTurn({
      actorUserId: context.auth.userId,
      workspaceId: context.workspace.workspace.id,
      conversationId,
      runId,
      action: action!,
    })
    return NextResponse.json(result)
  } catch (error) {
    return agentEnvironmentErrorResponse(error)
  }
}
