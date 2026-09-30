import { NextResponse } from 'next/server'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import { getOverlayServerContext } from '@/server/bootstrap'
import { surfaceActorFrom, surfaceErrorResponse, surfaceParamId } from '../../shared'

export async function DELETE(_request: Request, context: AppApiRouteContext) {
  try {
    const bindingId = await surfaceParamId(context, 'bindingId')
    const binding = await getOverlayServerContext().surfaceService.removeBinding({
      actor: surfaceActorFrom(context),
      workspaceId: context.workspace.workspace.id,
      bindingId,
    })
    return NextResponse.json({ binding }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    return surfaceErrorResponse(error)
  }
}
