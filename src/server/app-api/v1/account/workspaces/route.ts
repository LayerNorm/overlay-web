import { NextResponse } from 'next/server'
import type {
  WorkspaceCreateResponse,
} from '@overlay/workspace-contracts'
import type { AccountAppApiRouteContext } from '@/server/app-api/bff-context'
import { getOverlayServerContext } from '@/server/bootstrap'
import { ACTIVE_WORKSPACE_COOKIE } from '@/shared/workspaces/constants'
import { parseCreateInput, workspaceErrorResponse } from '@/server/app-api/v1/workspaces/route'
import { toWorkspaceSummaryWithRoutingHandle } from '@/server/app-api/v1/workspaces/presentation'

export async function POST(_request: Request, context: AccountAppApiRouteContext) {
  try {
    const input = parseCreateInput(context.parsedJson)
    const service = getOverlayServerContext().workspaceService
    const access = await service.createOrganization({
      actorUserId: context.auth.userId,
      name: input.name,
      slug: input.slug,
      displayName: context.auth.profile?.displayName,
      email: context.auth.profile?.email,
    })
    await service.setActiveWorkspace(context.auth.userId, access.workspace.id)
    const response: WorkspaceCreateResponse = {
      workspace: await toWorkspaceSummaryWithRoutingHandle(
        service,
        context.auth.userId,
        access,
        { memberCount: 1, humanMemberCount: 1 },
      ),
    }
    const result = NextResponse.json(response, { status: 201 })
    result.cookies.set(ACTIVE_WORKSPACE_COOKIE, access.workspace.id, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: 60 * 60 * 24 * 365,
    })
    return result
  } catch (error) {
    return workspaceErrorResponse(error, 'Failed to create workspace')
  }
}
