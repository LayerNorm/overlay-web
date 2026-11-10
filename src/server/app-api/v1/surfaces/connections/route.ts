import { NextResponse } from 'next/server'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import { getOverlayServerContext } from '@/server/bootstrap'
import { getSlackAdapter } from '@/server/surfaces/chat'
import { SurfaceServiceError } from '@/server/surfaces/SurfaceService'
import { surfaceActorFrom, surfaceErrorResponse } from '../shared'

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

export async function DELETE(_request: Request, context: AppApiRouteContext) {
  try {
    const connectionId = typeof context.parsedQuery.connectionId === 'string' ? context.parsedQuery.connectionId.trim() : ''
    if (!connectionId) throw new SurfaceServiceError('validation', 'connectionId is required')
    const connection = await getOverlayServerContext().surfaceService.disconnect({
      actor: surfaceActorFrom(context), workspaceId: context.workspace.workspace.id, connectionId,
    })
    await (await getSlackAdapter()).deleteInstallation(connection.externalTeamId)
    return NextResponse.json({ connection }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    return surfaceErrorResponse(error)
  }
}
