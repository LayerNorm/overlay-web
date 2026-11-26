import { NextRequest } from 'next/server'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import { fileService } from '@/server/files/http'
import { applyStoredContentSafetyHeaders, htmlPageHeaders } from '@/server/files/stored-content-headers'
export async function GET(
  request: NextRequest,
  context: AppApiRouteContext,
) {
  const { auth } = context
  const { fileId } = await context.params as { fileId: string }
  // An HTML file as a sandboxed page of its own, for the in-app preview frame (its scripts run, off the app origin).
  if (request.nextUrl.searchParams.get('view') === 'page') {
    const page = await fileService.getHtmlPage({ fileId, userId: auth.userId })
    if (!page) return Response.json({ error: 'Not found' }, { status: 404 })
    return new Response(page.html, { status: 200, headers: htmlPageHeaders(page.name) })
  }
  const result = await fileService.getContentProxy({
    fileId,
    userId: auth.userId,
  })

  if (result.kind === 'json') {
    return Response.json(result.payload, { status: result.status })
  }
  if (result.kind === 'redirect') {
    return Response.redirect(result.url, 302)
  }

  const upstreamHeaders = new Headers()
  const range = request.headers.get('range')
  if (range) upstreamHeaders.set('range', range)
  const upstream = await fetch(result.url, { headers: upstreamHeaders })
  if (!upstream.ok || !upstream.body) {
    return Response.json({ error: 'Failed to load stored asset.' }, { status: 502 })
  }
  const headers = new Headers()
  for (const header of [
    'accept-ranges',
    'content-length',
    'content-range',
    'content-type',
    'etag',
    'last-modified',
  ]) {
    const value = upstream.headers.get(header)
    if (value) headers.set(header, value)
  }
  const upstreamDisposition = upstream.headers.get('content-disposition')
  headers.set(
    'content-disposition',
    upstreamDisposition || `inline; filename*=UTF-8''${encodeURIComponent(result.name)}`,
  )
  headers.set('cache-control', 'private, no-store')
  applyStoredContentSafetyHeaders(headers)
  return new Response(upstream.body, { status: upstream.status, headers })
}
