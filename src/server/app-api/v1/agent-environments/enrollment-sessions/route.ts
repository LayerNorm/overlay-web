import { NextResponse } from 'next/server'
import {
  isOverlayManagedAcpAdapterId,
  type OverlayManagedAcpAdapterId,
} from '@overlay/sandbox-runtime'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import { getOverlayServerContext } from '@/server/bootstrap'
import { buildAgentHostEnrollmentCommand } from '@/server/agents/agent-enrollment-command'
import { agentEnvironmentErrorResponse } from '../shared'

export async function POST(request: Request, context: AppApiRouteContext) {
  try {
    const body = context.parsedJson as Partial<{ adapterId: string }>
    const requestedAdapterId = body.adapterId?.trim()
    let adapterId: OverlayManagedAcpAdapterId | undefined
    if (requestedAdapterId) {
      if (!isOverlayManagedAcpAdapterId(requestedAdapterId)) {
        return NextResponse.json({ error: 'Unsupported agent harness', code: 'adapter_invalid' }, { status: 400 })
      }
      adapterId = requestedAdapterId
    }
    const enrollment = await getOverlayServerContext().connectedAgentControlPlane.createEnrollmentSession({
      actorUserId: context.auth.userId,
      workspaceId: context.workspace.workspace.id,
    })
    const origin = new URL(request.url).origin
    return NextResponse.json({
      ...enrollment,
      command: buildAgentHostEnrollmentCommand({
        code: enrollment.code,
        origin,
        ...(adapterId ? { adapterId } : {}),
      }),
    }, { status: 201, headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    return agentEnvironmentErrorResponse(error)
  }
}
