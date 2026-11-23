import { NextResponse } from 'next/server'
import type { WorkspaceInvitationAcceptResponse } from '@overlay/workspace-contracts'
import type { AccountAppApiRouteContext } from '@/server/app-api/bff-context'
import { getOverlaySession } from '@/server/auth/session'
import { getOverlayServerContext } from '@/server/bootstrap'
import { WorkspaceServiceError } from '@/server/workspaces/WorkspaceService'
import { resolveInviteeIdentity } from '@/server/workspaces/invitee-identity'
import { ACTIVE_WORKSPACE_COOKIE } from '@/shared/workspaces/constants'
import { workspaceErrorResponse } from '@/server/app-api/v1/workspaces/route'
import { requiredWorkspaceParam, validation } from '@/server/app-api/v1/workspaces/inputs'
import { toWorkspaceSummaryWithRoutingHandle } from '@/server/app-api/v1/workspaces/presentation'

export async function POST(request: Request, context: AccountAppApiRouteContext) {
  try {
    if (context.auth.authType !== 'session' && context.auth.authType !== 'access-token') {
      throw new WorkspaceServiceError(
        'Workspace invitations must be accepted by a signed-in user',
        403,
        'forbidden',
      )
    }
    const server = getOverlayServerContext()
    const invitee = await resolveInviteeIdentity({
      authType: context.auth.authType,
      userId: context.auth.userId,
      accessToken: context.auth.accessToken,
      session: await getOverlaySession(request),
      provider: server.auth,
    })
    if (!invitee) throw validation('The signed-in account does not have a verified email address')
    const service = server.workspaceService
    const access = await service.acceptInvitation({
      invitationId: requiredWorkspaceParam(await context.params, 'invitationId'),
      userId: context.auth.userId,
      email: invitee.email,
      displayName: invitee.displayName,
    })
    await service.setActiveWorkspace(context.auth.userId, access.workspace.id)
    const response: WorkspaceInvitationAcceptResponse = {
      activeWorkspaceId: access.workspace.id,
      workspace: await toWorkspaceSummaryWithRoutingHandle(service, context.auth.userId, access),
    }
    const result = NextResponse.json(response)
    result.cookies.set(ACTIVE_WORKSPACE_COOKIE, access.workspace.id, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: 60 * 60 * 24 * 365,
    })
    return result
  } catch (error) {
    return workspaceErrorResponse(error, 'Failed to accept workspace invitation')
  }
}
