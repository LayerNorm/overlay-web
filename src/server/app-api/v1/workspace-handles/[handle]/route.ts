import { NextResponse } from 'next/server'
import type { AccountAppApiRouteContext } from '@/server/app-api/bff-context'
import { getOverlayServerContext } from '@/server/bootstrap'

export async function GET(_request: Request, context: AccountAppApiRouteContext) {
  const handle = context.params.handle
  const resolution = await getOverlayServerContext().workspaceService.resolveWorkspaceHandle({
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
