import { NextResponse } from 'next/server'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import { logger } from '@/server/observability/logger'
import { validatePublicNetworkUrl } from '@/server/security/ssrf'
import { framedByHeaders } from './embeddable'

/**
 * Can this page be shown inside the link preview panel?
 *
 * A frame blocked by `X-Frame-Options` or `frame-ancestors` still fires `load`
 * in Chrome, so the browser cannot tell a blocked page from a slow one. Reading
 * the response headers server-side is the only reliable check, and it lets the
 * panel show "open in a new tab" immediately instead of a blank frame.
 */

const FETCH_TIMEOUT_MS = 4_000
const MAX_REDIRECTS = 5
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308])

async function discardBody(response: Response): Promise<void> {
  await response.body?.cancel().catch((_error) => undefined)
}

export async function GET(request: Request, _context: AppApiRouteContext) {
  const requestUrl = new URL(request.url)
  const target = requestUrl.searchParams.get('url') ?? ''

  const validated = await validatePublicNetworkUrl(target, { requireHttps: false })
  if (!validated.ok) {
    return NextResponse.json({ embeddable: false, reason: validated.error }, { status: 200 })
  }

  let current = validated.url
  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      const response = await fetch(current, {
        method: 'GET',
        // Follow redirects hop-by-hop so a public URL cannot bounce into
        // private/link-local space after the initial SSRF check.
        redirect: 'manual',
        // Never forward the caller's cookies or auth to a third-party origin.
        credentials: 'omit',
        headers: { 'user-agent': 'OverlayLinkPreview/1.0' },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      })

      if (!REDIRECT_STATUSES.has(response.status)) {
        await discardBody(response)
        return NextResponse.json({
          embeddable: framedByHeaders(response.headers, requestUrl.origin),
        })
      }

      const location = response.headers.get('location')
      await discardBody(response)
      if (!location) {
        return NextResponse.json({
          embeddable: framedByHeaders(response.headers, requestUrl.origin),
        })
      }
      if (hop === MAX_REDIRECTS) {
        return NextResponse.json({ embeddable: false, reason: 'too_many_redirects' }, { status: 200 })
      }

      let next: URL
      try {
        next = new URL(location, current)
      } catch (_error) {
        return NextResponse.json({ embeddable: false, reason: 'invalid_redirect' }, { status: 200 })
      }
      const nextValidated = await validatePublicNetworkUrl(next.toString(), { requireHttps: false })
      if (!nextValidated.ok) {
        return NextResponse.json({ embeddable: false, reason: nextValidated.error }, { status: 200 })
      }
      current = nextValidated.url
    }

    return NextResponse.json({ embeddable: false, reason: 'too_many_redirects' }, { status: 200 })
  } catch (error) {
    // Our network is not the user's: a fetch we cannot make may still frame
    // fine in their browser, so stay optimistic and let the panel decide.
    logger.warn('[link-preview] Embeddability probe failed', {
      host: current.hostname,
      error: error instanceof Error ? error.message : String(error),
    })
    return NextResponse.json({ embeddable: true, reason: 'probe_failed' })
  }
}
