import { NextResponse } from 'next/server'
import { filesystemGrantSchema } from '@overlay/agent-bridge-protocol'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import { getOverlayServerContext } from '@/server/bootstrap'
import { agentEnvironmentErrorResponse, environmentIdFrom } from '../../shared'

export async function PATCH(_request: Request, context: AppApiRouteContext) {
  try {
    const environment = await getOverlayServerContext().connectedAgentControlPlane.updateFilesystemGrant({
      actorUserId: context.auth.userId,
      workspaceId: context.workspace.workspace.id,
      environmentId: await environmentIdFrom(context),
      filesystemGrant: filesystemGrantSchema.parse(context.parsedJson.filesystemGrant),
    })
    return NextResponse.json({ environment }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    return agentEnvironmentErrorResponse(error)
  }
}
