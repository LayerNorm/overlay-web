import { NextResponse } from 'next/server'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import { getOverlayServerContext } from '@/server/bootstrap'
import { actorFrom, computerErrorResponse, computerIdFrom } from '../../shared'

export async function POST(_request: Request, context: AppApiRouteContext) {
  try {
    const args = {
      actor: actorFrom(context),
      workspaceId: context.workspace.workspace.id,
      computerId: await computerIdFrom(context),
    }
    const computer = context.parsedJson.action === 'take'
      ? await getOverlayServerContext().computerService.takeControl(args)
      : await getOverlayServerContext().computerService.releaseControl(args)
    return NextResponse.json({ computer }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    return computerErrorResponse(error)
  }
}
