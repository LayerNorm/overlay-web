import { NextResponse } from 'next/server'
import type {
  WorkspaceInvitationListResponse,
  WorkspaceInviteResponse,
} from '@overlay/workspace-contracts'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import { getOverlayServerContext } from '@/server/bootstrap'
import { workspaceErrorResponse } from '@/server/app-api/v1/workspaces/route'
import {
  invitationRole,
  requiredString,
  requiredWorkspaceParam,
} from '@/server/app-api/v1/workspaces/inputs'

export async function GET(_request: Request, context: AppApiRouteContext) {
  try {
    const workspaceId = requiredWorkspaceParam(await context.params, 'workspaceId')
    const invitations = await getOverlayServerContext().workspaceService.listInvitations({
      actorUserId: context.auth.userId,
      workspaceId,
    })
    const response: WorkspaceInvitationListResponse = { invitations }
    return NextResponse.json(response)
  } catch (error) {
    return workspaceErrorResponse(error, 'Failed to load workspace invitations')
  }
}

export async function POST(_request: Request, context: AppApiRouteContext) {
  try {
    const workspaceId = requiredWorkspaceParam(await context.params, 'workspaceId')
    const serverContext = getOverlayServerContext()
    // Invitation floods are the classic abuse path into a workspace.
    await serverContext.workspaceGovernanceService.assertWithinLimits({
      action: 'invitation.create',
      scope: {
        workspaceId: context.workspace.workspace.id,
        principalId: context.workspace.principal.id,
        guest: context.workspace.membership.role === 'guest',
      },
    })
    const invitation = await serverContext.workspaceService.invite({
      actorUserId: context.auth.userId,
      workspaceId,
      email: requiredString(context.parsedJson, 'email', { maxLength: 320 }),
      role: invitationRole(context.parsedJson),
    })
    const response: WorkspaceInviteResponse = {
      invitation,
      invitePath: `/app/invitations/${encodeURIComponent(invitation.id)}`,
    }
    return NextResponse.json(response, { status: 201 })
  } catch (error) {
    return workspaceErrorResponse(error, 'Failed to create workspace invitation')
  }
}
