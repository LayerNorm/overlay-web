import { NextResponse } from 'next/server'
import type { WorkspaceActivateResponse } from '@overlay/workspace-contracts'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import { getOverlayServerContext } from '@/server/bootstrap'
import { ACTIVE_WORKSPACE_COOKIE } from '@/shared/workspaces/constants'
import { toWorkspaceSummary } from '../presentation'
import { workspaceErrorResponse } from '../route'

export async function POST(_request: Request, context: AppApiRouteContext) {
  try {
    const workspaceId = typeof context.parsedJson.workspaceId === 'string'
      ? context.parsedJson.workspaceId.trim()
      : ''
    if (!workspaceId) {
      return NextResponse.json(
        { error: 'workspaceId is required', code: 'validation' },
        { status: 400 },
      )
    }

    const access = await getOverlayServerContext().workspaceService.setActiveWorkspace(
      context.auth.userId,
      workspaceId,
    )
    const response: WorkspaceActivateResponse = {
      activeWorkspaceId: access.workspace.id,
      workspace: toWorkspaceSummary(access),
    }
    const result = NextResponse.json(response)
    result.cookies.set(ACTIVE_WORKSPACE_COOKIE, access.workspace.id, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: 60 * 60 * 24 * 365,
    })
    return result
  } catch (error) {
    return workspaceErrorResponse(error, 'Failed to activate workspace')
  }
}
