import { NextResponse } from 'next/server'
import type { WorkspaceInvitationAcceptResponse } from '@overlay/workspace-contracts'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import { getOverlaySession } from '@/server/auth/session'
import { getOverlayServerContext } from '@/server/bootstrap'
import { WorkspaceServiceError } from '@/server/workspaces/WorkspaceService'
import { ACTIVE_WORKSPACE_COOKIE } from '@/shared/workspaces/constants'
import { workspaceErrorResponse } from '@/server/app-api/v1/workspaces/route'
import { requiredWorkspaceParam, validation } from '@/server/app-api/v1/workspaces/inputs'
import { toWorkspaceSummary } from '@/server/app-api/v1/workspaces/presentation'

export async function POST(request: Request, context: AppApiRouteContext) {
  try {
    if (context.auth.authType !== 'session') {
      throw new WorkspaceServiceError(
        'Workspace invitations must be accepted from a signed-in browser session',
        403,
        'forbidden',
      )
    }
    const session = await getOverlaySession(request)
    if (!session?.user.email) throw validation('The signed-in account does not have an email address')
    const service = getOverlayServerContext().workspaceService
    const access = await service.acceptInvitation({
      invitationId: requiredWorkspaceParam(await context.params, 'invitationId'),
      userId: context.auth.userId,
      email: session.user.email,
      displayName: [session.user.firstName, session.user.lastName].filter(Boolean).join(' ')
        || session.user.email,
    })
    await service.setActiveWorkspace(context.auth.userId, access.workspace.id)
    const response: WorkspaceInvitationAcceptResponse = {
      activeWorkspaceId: access.workspace.id,
      workspace: toWorkspaceSummary(access),
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
