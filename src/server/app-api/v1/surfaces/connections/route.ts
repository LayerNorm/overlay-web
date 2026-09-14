import { NextResponse } from 'next/server'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import { getOverlayServerContext } from '@/server/bootstrap'
import { surfaceErrorResponse } from '../shared'

export async function GET(_request: Request, context: AppApiRouteContext) {
  try {
    const connections = await getOverlayServerContext().surfaceService.listConnections({
      workspaceId: context.workspace.workspace.id,
    })
    return NextResponse.json({ connections }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    return surfaceErrorResponse(error)
  }
}
