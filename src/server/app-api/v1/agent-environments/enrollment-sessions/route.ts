import { NextResponse } from 'next/server'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import { getOverlayServerContext } from '@/server/bootstrap'
import { buildAgentHostEnrollmentCommand } from '@/server/agents/agent-enrollment-command'
import { agentEnvironmentErrorResponse } from '../shared'

/** Creates a single-use code that connects a machine (This Mac) so Overlay's agents can use it. */
export async function POST(request: Request, context: AppApiRouteContext) {
  try {
    const enrollment = await getOverlayServerContext().connectedAgentControlPlane.createEnrollmentSession({
      actorUserId: context.auth.userId,
      workspaceId: context.workspace.workspace.id,
    })
    return NextResponse.json({
      ...enrollment,
      command: buildAgentHostEnrollmentCommand({ code: enrollment.code, origin: new URL(request.url).origin }),
    }, { status: 201, headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    return agentEnvironmentErrorResponse(error)
  }
}
