import { NextResponse } from 'next/server'
import type { AccountAppApiRouteContext } from '@/server/app-api/bff-context'
import { getOverlayServerContext } from '@/server/bootstrap'
import type { WorkspaceService } from '@/server/workspaces/WorkspaceService'

export async function GET(_request: Request, context: AccountAppApiRouteContext) {
  return await handleWorkspaceHandleGet(context, getOverlayServerContext().workspaceService)
}

export async function handleWorkspaceHandleGet(
  context: AccountAppApiRouteContext,
  service: Pick<WorkspaceService, 'resolveWorkspaceHandle'>,
) {
  const params = await context.params
  const handle = typeof params.handle === 'string' ? params.handle : ''
  const resolution = await service.resolveWorkspaceHandle({
    userId: context.auth.userId,
    handle,
  })
  return resolution
    ? NextResponse.json(resolution, { headers: { 'Cache-Control': 'private, no-store' } })
    : NextResponse.json(
        { error: 'Workspace not found or you no longer have access.', code: 'workspace_not_found' },
        { status: 404, headers: { 'Cache-Control': 'private, no-store' } },
      )
}
