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

export async function GET(request: Request, _context: AppApiRouteContext) {
  const requestUrl = new URL(request.url)
  const target = requestUrl.searchParams.get('url') ?? ''

  const validated = await validatePublicNetworkUrl(target, { requireHttps: false })
  if (!validated.ok) {
    return NextResponse.json({ embeddable: false, reason: validated.error }, { status: 200 })
  }

  try {
    const response = await fetch(validated.url, {
      method: 'GET',
      redirect: 'follow',
      // Never forward the caller's cookies or auth to a third-party origin.
      credentials: 'omit',
      headers: { 'user-agent': 'OverlayLinkPreview/1.0' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })
    // Body is irrelevant; release the connection instead of buffering the page.
    await response.body?.cancel().catch((_error) => undefined)
    return NextResponse.json({
      embeddable: framedByHeaders(response.headers, requestUrl.origin),
    })
  } catch (error) {
    // Our network is not the user's: a fetch we cannot make may still frame
    // fine in their browser, so stay optimistic and let the panel decide.
    logger.warn('[link-preview] Embeddability probe failed', {
      host: validated.url.hostname,
      error: error instanceof Error ? error.message : String(error),
    })
    return NextResponse.json({ embeddable: true, reason: 'probe_failed' })
  }
}
