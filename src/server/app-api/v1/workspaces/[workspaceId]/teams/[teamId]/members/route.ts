import { NextResponse } from 'next/server'
import type { WorkspaceTeamMemberMutationResponse } from '@overlay/workspace-contracts'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import { getOverlayServerContext } from '@/server/bootstrap'
import { workspaceErrorResponse } from '@/server/app-api/v1/workspaces/route'
import {
  requiredString,
  requiredWorkspaceParam,
} from '@/server/app-api/v1/workspaces/inputs'

export async function POST(_request: Request, context: AppApiRouteContext) {
  try {
    const params = await context.params
    const member = await getOverlayServerContext().workspaceService.addTeamMember({
      actorUserId: context.auth.userId,
      workspaceId: requiredWorkspaceParam(params, 'workspaceId'),
      teamId: requiredWorkspaceParam(params, 'teamId'),
      principalId: requiredString(context.parsedJson, 'principalId'),
    })
    const response: WorkspaceTeamMemberMutationResponse = { member }
    return NextResponse.json(response, { status: 201 })
  } catch (error) {
    return workspaceErrorResponse(error, 'Failed to add workspace team member')
  }
}

export async function DELETE(_request: Request, context: AppApiRouteContext) {
  try {
    const params = await context.params
    const principalId = requiredString(context.parsedJson, 'principalId')
    await getOverlayServerContext().workspaceService.removeTeamMember({
      actorUserId: context.auth.userId,
      workspaceId: requiredWorkspaceParam(params, 'workspaceId'),
      teamId: requiredWorkspaceParam(params, 'teamId'),
      principalId,
    })
    return NextResponse.json({ removed: true, principalId })
  } catch (error) {
    return workspaceErrorResponse(error, 'Failed to remove workspace team member')
  }
}
