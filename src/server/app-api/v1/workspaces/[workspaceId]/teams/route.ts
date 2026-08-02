import { NextResponse } from 'next/server'
import type { WorkspaceTeamCreateResponse } from '@overlay/workspace-contracts'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import { getOverlayServerContext } from '@/server/bootstrap'
import { workspaceErrorResponse } from '@/server/app-api/v1/workspaces/route'
import {
  optionalString,
  requiredString,
  requiredWorkspaceParam,
} from '@/server/app-api/v1/workspaces/inputs'

export async function POST(_request: Request, context: AppApiRouteContext) {
  try {
    const team = await getOverlayServerContext().workspaceService.createTeam({
      actorUserId: context.auth.userId,
      workspaceId: requiredWorkspaceParam(await context.params, 'workspaceId'),
      name: requiredString(context.parsedJson, 'name', { maxLength: 80 }),
      description: optionalString(context.parsedJson, 'description', { maxLength: 280 }),
    })
    const response: WorkspaceTeamCreateResponse = { team }
    return NextResponse.json(response, { status: 201 })
  } catch (error) {
    return workspaceErrorResponse(error, 'Failed to create workspace team')
  }
}

export async function DELETE(_request: Request, context: AppApiRouteContext) {
  try {
    const teamId = requiredString(context.parsedJson, 'teamId')
    await getOverlayServerContext().workspaceService.archiveTeam({
      actorUserId: context.auth.userId,
      workspaceId: requiredWorkspaceParam(await context.params, 'workspaceId'),
      teamId,
    })
    return NextResponse.json({ archived: true, teamId })
  } catch (error) {
    return workspaceErrorResponse(error, 'Failed to archive workspace team')
  }
}
