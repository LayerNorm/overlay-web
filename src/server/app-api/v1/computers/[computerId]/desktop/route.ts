import { NextResponse } from 'next/server'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import { getOverlayServerContext } from '@/server/bootstrap'
import { actorFrom, computerErrorResponse, computerIdFrom } from '../../shared'

export async function POST(_request: Request, context: AppApiRouteContext) {
  try {
    const mode = context.parsedJson.mode === 'vnc' ? 'vnc' as const : 'webrtc' as const
    const ticket = await getOverlayServerContext().computerService.openDesktop({
      actor: actorFrom(context),
      computerId: await computerIdFrom(context),
      mode,
    })
    if (!ticket.ready) {
      return NextResponse.json(
        { error: 'The desktop stream is still preparing', code: 'desktop_preparing' },
        { status: 409, headers: { 'Cache-Control': 'no-store' } },
      )
    }
    // The ticket URL is a bearer secret — never log it; the shell marks this
    // route sensitiveResponse so it is not persisted by the idempotency store.
    return NextResponse.json(
      { url: ticket.url, mode: ticket.mode, expiresAt: ticket.expiresAt ?? null },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (error) {
    return computerErrorResponse(error)
  }
}
