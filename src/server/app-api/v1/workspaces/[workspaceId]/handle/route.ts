import { NextResponse } from 'next/server'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import { getOverlayServerContext } from '@/server/bootstrap'
import { WorkspaceServiceError } from '@/server/workspaces/WorkspaceService'

export async function PATCH(_request: Request, context: AppApiRouteContext) {
  const slug = context.parsedJson.slug
  if (typeof slug !== 'string') {
    throw new WorkspaceServiceError('slug is required', 400, 'validation')
  }
  const workspace = await getOverlayServerContext().workspaceService.updateWorkspaceHandle({
    actorUserId: context.auth.userId,
    workspaceId: context.params.workspaceId,
    slug,
  })
  return NextResponse.json({ workspace })
}
