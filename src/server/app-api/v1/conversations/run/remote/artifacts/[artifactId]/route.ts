import { NextResponse } from 'next/server'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import { getOverlayServerContext } from '@/server/bootstrap'
import { agentEnvironmentErrorResponse } from '@/server/app-api/v1/agent-environments/shared'

export async function GET(_request: Request, context: AppApiRouteContext) {
  try {
    const value = (await context.params).artifactId
    const artifactId = typeof value === 'string' ? value : ''
    const result = await getOverlayServerContext().connectedAgentControlPlane.getArtifactDownload({
      actorUserId: context.auth.userId, workspaceId: context.workspace.workspace.id, artifactId,
    })
    return NextResponse.redirect(result.url, 302)
  } catch (error) {
    return agentEnvironmentErrorResponse(error)
  }
}
