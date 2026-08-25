import { NextResponse } from 'next/server'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import { getOverlayServerContext } from '@/server/bootstrap'
import { agentEnvironmentErrorResponse } from '../shared'

export async function POST(request: Request, context: AppApiRouteContext) {
  try {
    const enrollment = await getOverlayServerContext().connectedAgentControlPlane.createEnrollmentSession({
      actorUserId: context.auth.userId,
      workspaceId: context.workspace.workspace.id,
    })
    const origin = new URL(request.url).origin
    return NextResponse.json({
      ...enrollment,
      command: `npx @overlay/agent-host connect ${enrollment.code} --server ${origin}`,
    }, { status: 201, headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    return agentEnvironmentErrorResponse(error)
  }
}
