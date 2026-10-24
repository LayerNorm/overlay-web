import { NextResponse } from 'next/server'
import type {
  AccountWorkspaceDirectoryResponse,
  WorkspaceCreateResponse,
} from '@overlay/workspace-contracts'
import type { AccountAppApiRouteContext } from '@/server/app-api/bff-context'
import { getOverlaySession } from '@/server/auth/session'
import { getOverlayServerContext } from '@/server/bootstrap'
import { ACTIVE_WORKSPACE_COOKIE } from '@/shared/workspaces/constants'
import { parseCreateInput, workspaceErrorResponse } from '@/server/app-api/v1/workspaces/route'
import { toWorkspaceSummaryWithRoutingHandle } from '@/server/app-api/v1/workspaces/presentation'
import type { WorkspaceService } from '@/server/workspaces/WorkspaceService'

export async function GET(request: Request, context: AccountAppApiRouteContext) {
  try {
    const service = getOverlayServerContext().workspaceService
    const session = await getOverlaySession(request)
    return NextResponse.json(await buildAccountWorkspaceDirectory({
      service,
      userId: context.auth.userId,
      email: session?.user.email,
      now: Date.now(),
    }))
  } catch (error) {
    return workspaceErrorResponse(error, 'Failed to load account workspaces')
  }
}

export async function buildAccountWorkspaceDirectory(args: {
  service: Pick<WorkspaceService, 'listForUser' | 'resolveActiveWorkspace' | 'listReceivedInvitations' | 'countMemberKinds' | 'resolveWorkspaceHandle'>
  userId: string
  email?: string
  now: number
}): Promise<AccountWorkspaceDirectoryResponse> {
  const accesses = await args.service.listForUser(args.userId)
  const [active, invitations] = await Promise.all([
    accesses.length ? args.service.resolveActiveWorkspace(args.userId) : null,
    args.email ? args.service.listReceivedInvitations({ email: args.email, now: args.now }) : [],
  ])
  const workspaces = await Promise.all(accesses.map(async (access) => {
    const counts = await args.service.countMemberKinds({
      actorUserId: args.userId,
      workspaceId: access.workspace.id,
    })
    return toWorkspaceSummaryWithRoutingHandle(args.service, args.userId, access, counts)
  }))
  return {
    workspaces,
    activeWorkspaceId: active?.workspace.id ?? '',
    invitations,
  }
}

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
