import { NextResponse } from 'next/server'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import { getOverlayServerContext } from '@/server/bootstrap'
import { getSlackAdapter } from '@/server/surfaces/chat'
import { surfaceErrorResponse, surfaceParamId } from '../../../shared'

export async function GET(_request: Request, context: AppApiRouteContext) {
  try {
    const connectionId = await surfaceParamId(context, 'connectionId')
    const channels = await getOverlayServerContext().surfaceService.listChannels({
      workspaceId: context.workspace.workspace.id,
      connectionId,
      adapter: await getSlackAdapter(),
    })
    return NextResponse.json({ channels }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    return surfaceErrorResponse(error)
  }
}
