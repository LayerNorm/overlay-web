import { NextResponse } from 'next/server'
import type { WorkspaceArchiveResponse } from '@overlay/workspace-contracts'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import { getOverlayServerContext } from '@/server/bootstrap'
import { workspaceErrorResponse } from '@/server/app-api/v1/workspaces/route'
import { requiredWorkspaceParam } from '@/server/app-api/v1/workspaces/inputs'

export async function PATCH(request: Request, context: AppApiRouteContext) {
  try {
    const body = Object.keys(context.parsedJson).length > 0 ? context.parsedJson : await request.json().catch((_error) => ({}))
    const workspace = await getOverlayServerContext().workspaceService.renameWorkspace({
      actorUserId: context.auth.userId,
      workspaceId: requiredWorkspaceParam(await context.params, 'workspaceId'),
      name: typeof body.name === 'string' ? body.name : '',
    })
    return NextResponse.json({ workspace })
  } catch (error) {
    return workspaceErrorResponse(error, 'Failed to rename workspace')
  }
}

export async function DELETE(_request: Request, context: AppApiRouteContext) {
  try {
    const workspace = await getOverlayServerContext().workspaceService.archiveWorkspace({
      actorUserId: context.auth.userId,
      workspaceId: requiredWorkspaceParam(await context.params, 'workspaceId'),
    })
    const response: WorkspaceArchiveResponse = { workspace }
    return NextResponse.json(response)
  } catch (error) {
    return workspaceErrorResponse(error, 'Failed to archive workspace')
  }
}
