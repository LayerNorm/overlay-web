import { NextResponse, type NextRequest } from 'next/server'

const IS_DEVELOPMENT = process.env.NODE_ENV !== 'production'

function convexOrigin(): string {
  const url = (
    process.env.ADMIN_CONVEX_URL
    ?? (IS_DEVELOPMENT ? process.env.DEV_NEXT_PUBLIC_CONVEX_URL : undefined)
    ?? process.env.NEXT_PUBLIC_CONVEX_URL
    ?? ''
  ).trim().replace(/\/+$/, '')
  return url ? new URL(url).origin : ''
}

function createCspNonce(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

/**
 * Per-request nonce CSP: Next.js ships inline RSC bootstrap scripts
 * (`self.__next_f.push`) that a static `script-src 'self'` blocks, killing
 * hydration on every page. Next reads the CSP header on the request and
 * stamps the nonce onto the scripts it renders. The remaining security
 * headers stay in next.config.ts.
 */
export function buildCspPolicy(nonce: string): string {
  const origin = convexOrigin()
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}'${IS_DEVELOPMENT ? " 'unsafe-eval'" : ''}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    `connect-src 'self' https://api.workos.com${origin ? ` ${origin}` : ''}${IS_DEVELOPMENT ? ' ws: wss:' : ''}`,
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join('; ')
}

export function proxy(request: NextRequest) {
  const nonce = createCspNonce()
  const csp = buildCspPolicy(nonce)
  const requestHeaders = new Headers(request.headers)
  requestHeaders.set('Content-Security-Policy', csp)
  requestHeaders.set('x-nonce', nonce)
  const response = NextResponse.next({ request: { headers: requestHeaders } })
  response.headers.set('Content-Security-Policy', csp)
  return response
}

export const config = {
  matcher: ['/((?!_next/|favicon.ico|.*\\..*).*)'],
}
