import { NextResponse } from 'next/server'
import { WorkOS } from '@workos-inc/node'
import type { WorkspaceInvitationAcceptResponse } from '@overlay/workspace-contracts'
import type { AccountAppApiRouteContext } from '@/server/app-api/bff-context'
import { getOverlaySession } from '@/server/auth/session'
import { getOverlayServerContext } from '@/server/bootstrap'
import { WorkspaceServiceError } from '@/server/workspaces/WorkspaceService'
import { ACTIVE_WORKSPACE_COOKIE } from '@/shared/workspaces/constants'
import { workspaceErrorResponse } from '@/server/app-api/v1/workspaces/route'
import { requiredWorkspaceParam, validation } from '@/server/app-api/v1/workspaces/inputs'
import { toWorkspaceSummaryWithRoutingHandle } from '@/server/app-api/v1/workspaces/presentation'

export async function POST(request: Request, context: AccountAppApiRouteContext) {
  try {
    if (context.auth.authType !== 'session' && context.auth.authType !== 'access-token') {
      throw new WorkspaceServiceError(
        'Workspace invitations must be accepted from a signed-in browser session',
        403,
        'forbidden',
      )
    }
    const session = await getOverlaySession(request)
    let user: { email?: string; firstName?: string; lastName?: string } | undefined = session?.user
    if (!user?.email && context.auth.authType === 'access-token') {
      const found = await new WorkOS(process.env.WORKOS_API_KEY).userManagement.getUser(context.auth.userId)
      if (found.emailVerified) user = { email: found.email, firstName: found.firstName ?? undefined, lastName: found.lastName ?? undefined }
    }
    if (!user?.email) throw validation('The signed-in account does not have an email address')
    const service = getOverlayServerContext().workspaceService
    const access = await service.acceptInvitation({
      invitationId: requiredWorkspaceParam(await context.params, 'invitationId'),
      userId: context.auth.userId,
      email: user.email,
      displayName: [user.firstName, user.lastName].filter(Boolean).join(' ')
        || user.email,
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
