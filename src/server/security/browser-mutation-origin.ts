import 'server-only'

import { NextResponse, type NextRequest } from 'next/server'

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

type BrowserMutationAuth = {
  authType: 'session' | 'api-key' | 'service' | 'access-token'
}

/**
 * Cookie-authenticated browser mutations must come from this application. API-key,
 * service, and bearer-token callers are intentionally unaffected: they do not rely
 * on a browser session cookie and already prove possession of a credential.
 */
export function rejectCrossSiteBrowserMutation(
  request: NextRequest,
  auth: BrowserMutationAuth,
): NextResponse | null {
  if (auth.authType !== 'session' || SAFE_METHODS.has(request.method.toUpperCase())) {
    return null
  }

  const origin = request.headers.get('origin')
  const fetchSite = request.headers.get('sec-fetch-site')?.toLowerCase()
  if (
    fetchSite === 'cross-site' ||
    (origin !== null && origin !== request.nextUrl.origin)
  ) {
    return NextResponse.json(
      { error: 'Invalid request origin' },
      { status: 403, headers: { 'Cache-Control': 'no-store' } },
    )
  }

  return null
}
