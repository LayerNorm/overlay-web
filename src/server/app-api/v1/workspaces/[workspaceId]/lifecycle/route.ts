import { NextResponse } from 'next/server'
import type { WorkspaceArchiveResponse } from '@overlay/workspace-contracts'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import { getOverlayServerContext } from '@/server/bootstrap'
import { workspaceErrorResponse } from '@/server/app-api/v1/workspaces/route'
import { requiredWorkspaceParam } from '@/server/app-api/v1/workspaces/inputs'

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
