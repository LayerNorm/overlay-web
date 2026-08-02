import { NextResponse } from 'next/server'
import type { WorkspaceInviteResponse } from '@overlay/workspace-contracts'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import { getOverlayServerContext } from '@/server/bootstrap'
import { workspaceErrorResponse } from '@/server/app-api/v1/workspaces/route'
import { requiredWorkspaceParam } from '@/server/app-api/v1/workspaces/inputs'

export async function POST(_request: Request, context: AppApiRouteContext) {
  try {
    const params = await context.params
    const workspaceId = requiredWorkspaceParam(params, 'workspaceId')
    const invitationId = requiredWorkspaceParam(params, 'invitationId')
    const invitation = await getOverlayServerContext().workspaceService.resendInvitation({
      actorUserId: context.auth.userId,
      workspaceId,
      invitationId,
    })
    const response: WorkspaceInviteResponse = {
      invitation,
      invitePath: `/app/invitations/${encodeURIComponent(invitation.id)}`,
    }
    return NextResponse.json(response)
  } catch (error) {
    return workspaceErrorResponse(error, 'Failed to resend workspace invitation')
  }
}

export async function DELETE(_request: Request, context: AppApiRouteContext) {
  try {
    const params = await context.params
    const invitation = await getOverlayServerContext().workspaceService.cancelInvitation({
      actorUserId: context.auth.userId,
      workspaceId: requiredWorkspaceParam(params, 'workspaceId'),
      invitationId: requiredWorkspaceParam(params, 'invitationId'),
    })
    return NextResponse.json({ invitation })
  } catch (error) {
    return workspaceErrorResponse(error, 'Failed to cancel workspace invitation')
  }
}
