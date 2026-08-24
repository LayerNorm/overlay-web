import { NextResponse } from 'next/server'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import { getOverlayServerContext } from '@/server/bootstrap'
import { agentEnvironmentErrorResponse, environmentIdFrom } from '../../shared'

export async function POST(_request: Request, context: AppApiRouteContext) {
  try {
    const environmentId = await environmentIdFrom(context)
    await getOverlayServerContext().connectedAgentControlPlane.revokeEnvironment({
      actorUserId: context.auth.userId,
      workspaceId: context.workspace.workspace.id,
      environmentId,
    })
    return NextResponse.json({ revoked: true, environmentId }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    return agentEnvironmentErrorResponse(error)
  }
}
