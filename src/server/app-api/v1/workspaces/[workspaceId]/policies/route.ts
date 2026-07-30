import { NextResponse } from 'next/server'
import { canManageWorkspace, type WorkspaceSharingPolicyResponse } from '@overlay/workspace-contracts'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import { getOverlayServerContext } from '@/server/bootstrap'
import { workspaceErrorResponse } from '@/server/app-api/v1/workspaces/route'
import { requiredWorkspaceParam, validation } from '@/server/app-api/v1/workspaces/inputs'

export async function GET(_request: Request, context: AppApiRouteContext) {
  try {
    const workspaceId = requiredWorkspaceParam(await context.params, 'workspaceId')
    const service = getOverlayServerContext().workspaceService
    const [access, policy] = await Promise.all([
      service.resolveActiveWorkspace(context.auth.userId, workspaceId),
      service.getSharingPolicy({ actorUserId: context.auth.userId, workspaceId }),
    ])
    return NextResponse.json({
      policy,
      canManage: canManageWorkspace(access.membership.role),
    } satisfies WorkspaceSharingPolicyResponse)
  } catch (error) {
    return workspaceErrorResponse(error, 'Failed to load workspace policy')
  }
}

export async function PATCH(_request: Request, context: AppApiRouteContext) {
  try {
    const workspaceId = requiredWorkspaceParam(await context.params, 'workspaceId')
    const value = context.parsedJson.publicLinksEnabled
    if (typeof value !== 'boolean') throw validation('publicLinksEnabled must be a boolean')
    const policy = await getOverlayServerContext().workspaceService.setSharingPolicy({
      actorUserId: context.auth.userId,
      workspaceId,
      publicLinksEnabled: value,
    })
    return NextResponse.json({ policy, canManage: true } satisfies WorkspaceSharingPolicyResponse)
  } catch (error) {
    return workspaceErrorResponse(error, 'Failed to update workspace policy')
  }
}
