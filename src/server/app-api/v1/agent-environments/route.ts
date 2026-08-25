import { NextResponse } from 'next/server'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import { getOverlayServerContext } from '@/server/bootstrap'
import { agentEnvironmentErrorResponse } from './shared'

export async function GET(_request: Request, context: AppApiRouteContext) {
  try {
    const environments = await getOverlayServerContext().connectedAgentControlPlane.listEnvironments({
      actorUserId: context.auth.userId,
      workspaceId: context.workspace.workspace.id,
    })
    return NextResponse.json({ environments }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    return agentEnvironmentErrorResponse(error)
  }
}
