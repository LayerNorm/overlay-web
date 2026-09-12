import { NextResponse } from 'next/server'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import { getOverlayServerContext } from '@/server/bootstrap'
import { actorFrom, computerErrorResponse, computerIdFrom } from '../shared'

export async function GET(_request: Request, context: AppApiRouteContext) {
  try {
    const computer = await getOverlayServerContext().computerService.getForActor({
      actor: actorFrom(context),
      computerId: await computerIdFrom(context),
    })
    return NextResponse.json({ computer }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    return computerErrorResponse(error)
  }
}

export async function DELETE(_request: Request, context: AppApiRouteContext) {
  try {
    await getOverlayServerContext().computerService.destroy({
      actor: actorFrom(context),
      computerId: await computerIdFrom(context),
    })
    return new NextResponse(null, { status: 204 })
  } catch (error) {
    return computerErrorResponse(error)
  }
}
