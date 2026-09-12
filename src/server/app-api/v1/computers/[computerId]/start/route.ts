import { NextResponse } from 'next/server'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import { getOverlayServerContext } from '@/server/bootstrap'
import { actorFrom, computerErrorResponse, computerIdFrom } from '../../shared'

export async function POST(_request: Request, context: AppApiRouteContext) {
  try {
    const computer = await getOverlayServerContext().computerService.start({
      actor: actorFrom(context),
      computerId: await computerIdFrom(context),
    })
    return NextResponse.json({ computer }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    return computerErrorResponse(error)
  }
}
