import { NextResponse } from 'next/server'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import { getOverlayServerContext } from '@/server/bootstrap'
import { agentEnvironmentErrorResponse, environmentIdFrom } from '../../shared'

/**
 * Clears a managed-harness environment's persisted HarnessAgent sessions and
 * destroys its sandbox. The next turn recreates both — this is the editor's
 * "reset session" action for `protocolAdapter:'harness'` bindings.
 */
export async function POST(_request: Request, context: AppApiRouteContext) {
  try {
    const environmentId = await environmentIdFrom(context)
    const result = await getOverlayServerContext().connectedAgentControlPlane.resetHarnessEnvironment({
      actorUserId: context.auth.userId,
      workspaceId: context.workspace.workspace.id,
      environmentId,
    })
    return NextResponse.json({ ...result, environmentId }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    return agentEnvironmentErrorResponse(error)
  }
}
