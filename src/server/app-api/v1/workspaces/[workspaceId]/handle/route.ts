import { NextResponse } from 'next/server'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import { getOverlayServerContext } from '@/server/bootstrap'
import { workspaceErrorResponse } from '@/server/app-api/v1/workspaces/route'
import type { WorkspaceService } from '@/server/workspaces/WorkspaceService'

export async function PATCH(_request: Request, context: AppApiRouteContext) {
  return await handleWorkspaceHandlePatch(context, getOverlayServerContext().workspaceService)
}

export async function handleWorkspaceHandlePatch(
  context: AppApiRouteContext,
  service: Pick<WorkspaceService, 'updateWorkspaceHandle'>,
) {
  try {
    const params = await context.params
    const workspaceId = typeof params.workspaceId === 'string' ? params.workspaceId : ''
    const slug = context.parsedJson.slug
    if (!workspaceId || typeof slug !== 'string') {
      return NextResponse.json({ error: 'workspaceId and slug are required', code: 'validation' }, { status: 400 })
    }
    const workspace = await service.updateWorkspaceHandle({
      actorUserId: context.auth.userId,
      workspaceId,
      slug,
    })
    return NextResponse.json({ workspace })
  } catch (error) {
    return workspaceErrorResponse(error, 'Failed to update workspace handle')
  }
}
