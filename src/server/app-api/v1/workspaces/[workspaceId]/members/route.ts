import { NextResponse } from 'next/server'
import type {
  WorkspaceMemberMutationInput,
  WorkspaceMemberMutationResponse,
} from '@overlay/workspace-contracts'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import { getOverlayServerContext } from '@/server/bootstrap'
import { workspaceErrorResponse } from '@/server/app-api/v1/workspaces/route'
import {
  membershipStatus,
  requiredString,
  requiredWorkspaceParam,
  validation,
  workspaceRole,
} from '@/server/app-api/v1/workspaces/inputs'

export async function PATCH(_request: Request, context: AppApiRouteContext) {
  try {
    const workspaceId = requiredWorkspaceParam(await context.params, 'workspaceId')
    const principalId = requiredString(context.parsedJson, 'principalId')
    const action = requiredString(context.parsedJson, 'action') as WorkspaceMemberMutationInput['action']
    const service = getOverlayServerContext().workspaceService
    const membership = action === 'set-role'
      ? await service.setMembershipRole({
        actorUserId: context.auth.userId,
        workspaceId,
        principalId,
        role: workspaceRole(context.parsedJson),
      })
      : action === 'set-status'
        ? await service.setMembershipStatus({
          actorUserId: context.auth.userId,
          workspaceId,
          principalId,
          status: membershipStatus(context.parsedJson),
        })
        : action === 'transfer-ownership'
          ? await service.transferOwnership({
            actorUserId: context.auth.userId,
            workspaceId,
            toPrincipalId: principalId,
          })
          : (() => { throw validation('action is invalid') })()
    const response: WorkspaceMemberMutationResponse = { membership }
    return NextResponse.json(response)
  } catch (error) {
    return workspaceErrorResponse(error, 'Failed to update workspace member')
  }
}

export async function DELETE(_request: Request, context: AppApiRouteContext) {
  try {
    const workspaceId = requiredWorkspaceParam(await context.params, 'workspaceId')
    const principalId = requiredString(context.parsedJson, 'principalId')
    await getOverlayServerContext().workspaceService.removeMember({
      actorUserId: context.auth.userId,
      workspaceId,
      principalId,
    })
    return NextResponse.json({ removed: true, principalId })
  } catch (error) {
    return workspaceErrorResponse(error, 'Failed to remove workspace member')
  }
}
