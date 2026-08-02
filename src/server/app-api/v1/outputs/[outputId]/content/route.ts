import { NextRequest } from 'next/server'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import { outputService } from '@/server/outputs/http'

export const runtime = 'nodejs'

export async function GET(
  request: NextRequest,
  context: AppApiRouteContext,
) {
  void request
  const { outputId } = await context.params as { outputId: string }
  const result = await outputService.content({
    outputId,
    userId: context.auth.userId,
  })

  if (result.kind === 'json') return Response.json(result.payload, { status: result.status })
  if (result.kind === 'redirect') return Response.redirect(result.url, 302)

  const upstream = await fetch(result.url)
  if (!upstream.ok || !upstream.body) {
    return Response.json({ error: 'Failed to load stored asset.' }, { status: 502 })
  }
  const headers = new Headers()
  const contentType = upstream.headers.get('content-type')
  if (contentType) headers.set('content-type', contentType)
  const disposition = upstream.headers.get('content-disposition')
  if (disposition) headers.set('content-disposition', disposition)
  return new Response(upstream.body, { status: 200, headers })
}
