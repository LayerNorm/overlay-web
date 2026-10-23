import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { getServiceAuthHeaderName, verifyServiceAuthToken } from '@/server/auth/service-auth'
import { hasValidSessionCookieSignature } from '@/server/auth/session-cookie-signature'
import { previewHostnameAllowed } from '@/shared/web/preview-host'
import { isSupportedWorkspaceRoute } from '@/shared/workspaces/routing'

const SESSION_COOKIE_NAME = 'overlay_session'
const BETTER_AUTH_SESSION_COOKIE_NAME = 'better-auth.session_token'
const CSP_REPORT_PATH = '/api/security/csp-report'
const IS_DEVELOPMENT = process.env.NODE_ENV !== 'production'

// '/app' is intentionally public so guests can view the shell.
// /api/v1/* performs route-level auth so native clients can use bearer tokens
// instead of browser session cookies.
const PROTECTED_ROUTES = ['/account', '/api/entitlements', '/api/convex']

const PUBLIC_ROUTES = [
  '/',
  '/auth',
  '/api/auth',
  '/api/security',
  '/api/webhooks',
  '/api/checkout/verify',
]

function isDocsProxyRoute(pathname: string): boolean {
  return (
    pathname === '/docs' ||
    pathname.startsWith('/docs/') ||
    pathname.startsWith('/_mintlify/') ||
    pathname === '/api/request' ||
    pathname.startsWith('/mintlify-assets/')
  )
}

function isPublicRoute(pathname: string): boolean {
  return PUBLIC_ROUTES.some(
    (route) => pathname === route || pathname.startsWith(route + '/')
  )
}

function isProtectedRoute(pathname: string): boolean {
  return PROTECTED_ROUTES.some(
    (route) => pathname === route || pathname.startsWith(route + '/')
  )
}

function isBetterAuthSelected(): boolean {
  return process.env.AUTH_PROVIDER?.trim() === 'better-auth'
}

function hasBetterAuthSessionCookie(request: NextRequest): boolean {
  return request.cookies
    .getAll()
    .some((cookie) => (
      cookie.name === BETTER_AUTH_SESSION_COOKIE_NAME ||
      cookie.name.endsWith(`.${BETTER_AUTH_SESSION_COOKIE_NAME}`)
    ) && Boolean(cookie.value))
}

function parseOrigin(value: string | undefined): string | null {
  const trimmed = value?.trim()
  if (!trimmed) return null

  try {
    return new URL(trimmed).origin
  } catch {
    return null
  }
}

function uniqueSources(values: Array<string | null | undefined>): string[] {
  return Array.from(
    new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value)))
  )
}

function toWebSocketOrigin(origin: string | null): string | null {
  if (!origin) return null
  if (origin.startsWith('https://')) return `wss://${origin.slice('https://'.length)}`
  if (origin.startsWith('http://')) return `ws://${origin.slice('http://'.length)}`
  return null
}

function getR2CspOrigins(): string[] {
  const accountId = process.env.R2_ACCOUNT_ID?.trim()
  const bucketName = process.env.R2_BUCKET_NAME?.trim()
  const bucketOrigin =
    accountId && bucketName ? `https://${bucketName}.${accountId}.r2.cloudflarestorage.com` : null
  const s3Api = process.env.S3_API?.trim()
  if (s3Api) {
    const origin = parseOrigin(s3Api)
    return uniqueSources([origin, bucketOrigin])
  }
  if (!accountId) return []

  const accountOrigin = `https://${accountId}.r2.cloudflarestorage.com`
  return uniqueSources([accountOrigin, bucketOrigin])
}

function buildConnectSrc(): string[] {
  const prodConvexOrigin = parseOrigin(process.env.NEXT_PUBLIC_CONVEX_URL)
  const devConvexOrigin = parseOrigin(process.env.DEV_NEXT_PUBLIC_CONVEX_URL)

  return uniqueSources([
    "'self'",
    parseOrigin(process.env.NEXT_PUBLIC_POSTHOG_HOST),
    'https://us-assets.i.posthog.com',
    parseOrigin(process.env.NEXT_PUBLIC_SENTRY_DSN),
    parseOrigin(process.env.SENTRY_DSN),
    prodConvexOrigin,
    devConvexOrigin,
    toWebSocketOrigin(prodConvexOrigin),
    toWebSocketOrigin(devConvexOrigin),
    ...getR2CspOrigins(),
    IS_DEVELOPMENT ? 'ws:' : null,
    IS_DEVELOPMENT ? 'wss:' : null,
  ])
}

function getCspHeaderName(): 'Content-Security-Policy' | 'Content-Security-Policy-Report-Only' {
  const configured = process.env.SECURITY_CSP_ENFORCE?.trim().toLowerCase()
  if (configured === 'true') return 'Content-Security-Policy'
  if (configured === 'false') return 'Content-Security-Policy-Report-Only'
  return IS_DEVELOPMENT ? 'Content-Security-Policy-Report-Only' : 'Content-Security-Policy'
}

// Routes that always render per-request. Only these can carry a nonce: a
// statically prerendered page is served from cache, so its baked-in nonce would
// never match the per-request header and every Next script would be blocked.
const NONCE_ELIGIBLE_PREFIXES = ['/app/', '/auth/', '/share/', '/w/']
const NONCE_ELIGIBLE_EXACT = ['/app', '/auth', '/share']

// Marketing pages are prerendered even though they live under /app.
const NONCE_INELIGIBLE_PREFIXES = ['/app/home', '/app/pricing', '/app/manifesto']

export function isNonceEligiblePath(pathname: string): boolean {
  if (process.env.SECURITY_CSP_NONCE?.trim().toLowerCase() !== 'true') return false
  if (NONCE_INELIGIBLE_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))) {
    return false
  }
  if (NONCE_ELIGIBLE_EXACT.includes(pathname)) return true
  return NONCE_ELIGIBLE_PREFIXES.some((prefix) => pathname.startsWith(prefix))
}

function createCspNonce(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

/**
 * Inline scripts that ship in the statically prerendered shell, where a per-request nonce cannot be stamped, so they
 * are allowed by hash instead (only while a nonce is in force; otherwise 'unsafe-inline' covers them):
 *
 * - React's shell-time script, `requestAnimationFrame(function(){$RT=performance.now()});`. Blocked, `$RT` is never
 *   defined, so React's batched Suspense reveal (`$RC`) skips its timing logic and falls back to requestAnimationFrame.
 *   Its text belongs to React: the CSP test recomputes this hash from the installed react-dom and fails when an upgrade
 *   changes it.
 * - The theme initializer in the root layout (`THEME_INIT_SCRIPT`), so the saved theme applies before first paint
 *   instead of after hydration.
 */
export const INLINE_SCRIPT_HASHES = [
  "'sha256-7mu4H06fwDCjmnxxr/xNHyuQC6pLTHr4M2E4jXw5WZs='",
  "'sha256-8VDeVWpS/RIs4mDh7kcOp3E1YoVc88NbwYV/XbJs5mI='",
] as const

export function buildCspPolicy(nonce?: string): string {
  const scriptSrc = uniqueSources([
    "'self'",
    // With a nonce the browser ignores 'unsafe-inline', so only Next's own
    // nonced scripts run. Host allowlists are kept (no 'strict-dynamic') so the
    // analytics loaders keep working.
    // Statically prerendered pages cannot carry a per-request nonce, so they
    // stay on 'unsafe-inline' — see isNonceEligiblePath.
    nonce ? `'nonce-${nonce}'` : "'unsafe-inline'",
    ...(nonce ? INLINE_SCRIPT_HASHES : []),
    IS_DEVELOPMENT ? "'unsafe-eval'" : null,
    'https://va.vercel-scripts.com',
    'https://us-assets.i.posthog.com',
  ])

  const directives = [
    "default-src 'self'",
    `script-src ${scriptSrc.join(' ')}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data: https:",
    `connect-src ${buildConnectSrc().join(' ')}`,
    // `https:` backs the link preview panel, which frames arbitrary https pages
    // the user chose to open. Those frames are sandboxed without
    // allow-top-navigation, so a framed page cannot navigate the app.
    "frame-src 'self' blob: data: https:",
    "media-src 'self' blob: data:",
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'self'",
    `report-uri ${CSP_REPORT_PATH}`,
    'report-to csp-endpoint',
  ]

  if (!IS_DEVELOPMENT) {
    directives.push('upgrade-insecure-requests')
  }

  return directives.join('; ')
}

function applyBrowserSecurityHeaders(
  response: NextResponse,
  headerName: 'Content-Security-Policy' | 'Content-Security-Policy-Report-Only',
  cspPolicy: string,
): NextResponse {
  response.headers.set(headerName, cspPolicy)
  response.headers.set('Reporting-Endpoints', `csp-endpoint="${CSP_REPORT_PATH}"`)
  response.headers.delete(
    headerName === 'Content-Security-Policy'
      ? 'Content-Security-Policy-Report-Only'
      : 'Content-Security-Policy'
  )
  return response
}

function applyWorkspaceRouteHeaders(response: NextResponse, pathname: string): NextResponse {
  if (pathname.startsWith('/w/')) {
    response.headers.set('Cache-Control', 'private, no-store')
    response.headers.set('X-Robots-Tag', 'noindex, nofollow')
  }
  return response
}

function getCanonicalWorkspaceRewrite(request: NextRequest): URL | null {
  const handleRoute = request.nextUrl.pathname.match(/^\/w\/([^/]+)(?:\/(.*))?$/)
  const idRoute = request.nextUrl.pathname.match(/^\/app\/w\/([^/]+)(?:\/(.*))?$/)
  const match = handleRoute ?? idRoute
  if (!match) return null

  let target = ''
  try {
    target = decodeURIComponent(match[1] ?? '').trim()
    if (handleRoute) target = target.toLowerCase()
  } catch {
    return null
  }
  if (!target || target.includes('/') || target.includes('\\')) return null
  if (handleRoute && (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(target) || target.length < 3 || target.length > 63)) {
    return null
  }

  const nested = match[2]?.trim().replace(/^\/+|\/+$/g, '')
    || (handleRoute ? 'work' : 'chat')
  const nestedParts: string[] = []
  for (const part of nested.split('/')) {
    try {
      nestedParts.push(decodeURIComponent(part))
    } catch {
      return null
    }
  }
  if (nestedParts.some((part) =>
    !part || part === '.' || part === '..' || part.includes('\\') || part.includes('/'))) return null
  const requestedSurface = nestedParts[0] ?? ''
  const surface = requestedSurface
  if (!isSupportedWorkspaceRoute(surface, nestedParts.slice(1))) return null
  const rewriteUrl = request.nextUrl.clone()
  rewriteUrl.pathname = `/app/${surface === requestedSurface ? nested : 'chat'}`
  if (handleRoute) {
    rewriteUrl.searchParams.delete('workspaceId')
    rewriteUrl.searchParams.set('workspaceHandle', target)
  } else {
    rewriteUrl.searchParams.set('workspaceId', target)
  }
  return rewriteUrl
}

export async function proxy(request: NextRequest) {
  if (!previewHostnameAllowed(request.nextUrl.hostname, process.env.OVERLAY_DEPLOYMENT_ENV,
    process.env.NEXT_PUBLIC_APP_URL ?? '')) {
    return new NextResponse('Preview unavailable', { status: 404, headers: { 'cache-control': 'no-store' } })
  }
  const { pathname } = request.nextUrl

  if (isDocsProxyRoute(pathname)) {
    return NextResponse.next()
  }

  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/favicon') ||
    pathname.includes('.')
  ) {
    return NextResponse.next()
  }

  const cspHeaderName = getCspHeaderName()
  const cspNonce = isNonceEligiblePath(pathname) ? createCspNonce() : undefined
  const cspPolicy = buildCspPolicy(cspNonce)
  const requestHeaders = new Headers(request.headers)
  requestHeaders.delete('x-overlay-workspace-handle')
  requestHeaders.set(cspHeaderName, cspPolicy)
  // Next reads this to stamp the nonce onto the scripts it renders.
  if (cspNonce) requestHeaders.set('x-nonce', cspNonce)

  const nextResponse = () =>
    applyWorkspaceRouteHeaders(applyBrowserSecurityHeaders(
      NextResponse.next({
        request: {
          headers: requestHeaders,
        },
      }),
      cspHeaderName,
      cspPolicy,
    ), pathname)

  // /app/account is a legacy implementation route; account settings are canonical under /app/settings.
  if (pathname === '/app/account') {
    const destination = new URL('/app/settings' + request.nextUrl.search, request.url)
    destination.searchParams.set('section', 'account')
    return applyBrowserSecurityHeaders(
      NextResponse.redirect(destination),
      cspHeaderName,
      cspPolicy,
    )
  }

  if (pathname.startsWith('/w/')) {
    const hasSession = isBetterAuthSelected()
      ? hasBetterAuthSessionCookie(request)
      : await hasValidSessionCookieSignature(request.cookies.get(SESSION_COOKIE_NAME)?.value ?? '')
    if (!hasSession) {
      const signIn = new URL('/auth/sign-in', request.url)
      signIn.searchParams.set('redirect', request.nextUrl.pathname + request.nextUrl.search)
      return applyWorkspaceRouteHeaders(applyBrowserSecurityHeaders(
        NextResponse.redirect(signIn),
        cspHeaderName,
        cspPolicy,
      ), pathname)
    }
  }

  // Canonical workspace routes rewrite last: the checks above own specific
  // paths, while this one claims the /app/w/:workspaceId space.
  const workspaceRewrite = getCanonicalWorkspaceRewrite(request)
  if (workspaceRewrite) {
    if (pathname.startsWith('/w/')) {
      requestHeaders.delete('x-overlay-workspace-id')
      requestHeaders.set(
        'x-overlay-workspace-handle',
        workspaceRewrite.searchParams.get('workspaceHandle') ?? '',
      )
      requestHeaders.set('x-overlay-workspace-original-path', pathname)
      requestHeaders.set('x-overlay-workspace-original-search', request.nextUrl.search)
    } else {
      requestHeaders.delete('x-overlay-workspace-handle')
      requestHeaders.set(
        'x-overlay-workspace-id',
        workspaceRewrite.searchParams.get('workspaceId') ?? '',
      )
    }
    return applyWorkspaceRouteHeaders(applyBrowserSecurityHeaders(
      NextResponse.rewrite(workspaceRewrite, {
        request: {
          headers: requestHeaders,
        },
      }),
      cspHeaderName,
      cspPolicy,
    ), pathname)
  }

  if (isPublicRoute(pathname)) {
    return nextResponse()
  }

  if (isProtectedRoute(pathname)) {
    if (pathname.startsWith('/api/')) {
      const serviceAuth = await verifyServiceAuthToken(
        request.headers.get(getServiceAuthHeaderName()),
        {
          method: request.method,
          path: pathname,
          consumeReplay: false,
        },
      )
      if (serviceAuth) {
        return nextResponse()
      }
    }

    if (isBetterAuthSelected()) {
      if (hasBetterAuthSessionCookie(request)) {
        return nextResponse()
      }

      if (pathname.startsWith('/api/')) {
        return applyBrowserSecurityHeaders(
          NextResponse.json(
            { error: 'Authentication required' },
            { status: 401 }
          ),
          cspHeaderName,
          cspPolicy,
        )
      }
      const signInUrl = new URL('/auth/sign-in', request.url)
      // Preserve the original query: the desktop auth handoff carries
      // desktop_code_challenge on /account and must survive sign-in.
      signInUrl.searchParams.set('redirect', pathname + request.nextUrl.search)
      return applyBrowserSecurityHeaders(
        NextResponse.redirect(signInUrl),
        cspHeaderName,
        cspPolicy,
      )
    }

    const sessionCookie = request.cookies.get(SESSION_COOKIE_NAME)

    if (!sessionCookie?.value) {
      if (pathname.startsWith('/api/')) {
        return applyBrowserSecurityHeaders(
          NextResponse.json(
            { error: 'Authentication required' },
            { status: 401 }
          ),
          cspHeaderName,
          cspPolicy,
        )
      }
      const signInUrl = new URL('/auth/sign-in', request.url)
      signInUrl.searchParams.set('redirect', pathname + request.nextUrl.search)
      return applyBrowserSecurityHeaders(
        NextResponse.redirect(signInUrl),
        cspHeaderName,
        cspPolicy,
      )
    }

    if (!(await hasValidSessionCookieSignature(sessionCookie.value))) {
      if (pathname.startsWith('/api/')) {
        return applyBrowserSecurityHeaders(
          NextResponse.json(
            { error: 'Invalid session' },
            { status: 401 }
          ),
          cspHeaderName,
          cspPolicy,
        )
      }
      const signInUrl = new URL('/auth/sign-in', request.url)
      signInUrl.searchParams.set('redirect', pathname + request.nextUrl.search)
      return applyBrowserSecurityHeaders(
        NextResponse.redirect(signInUrl),
        cspHeaderName,
        cspPolicy,
      )
    }
  }

  // Preserve /account as a compatibility alias while making the canonical
  // settings query visible to client navigation. Internal rewrite query params
  // are not reliable input to useSearchParams during hydration.
  if (pathname === '/account') {
    const destination = new URL('/app/settings' + request.nextUrl.search, request.url)
    destination.searchParams.set('section', 'account')
    return applyBrowserSecurityHeaders(
      NextResponse.redirect(destination),
      cspHeaderName,
      cspPolicy,
    )
  }

  return nextResponse()
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|\\.well-known/workflow/).*)']
}
