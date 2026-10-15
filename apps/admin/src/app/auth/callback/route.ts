import { NextResponse, type NextRequest } from 'next/server'

import type { AdministrativePrincipal } from '@/server/admin/AdministrativeRepository'
import { adminConvexQuery } from '@/server/convex-admin'
import { allowedUserIds } from '@/server/env'
import {
  ADMIN_AUTH_STATE_COOKIE,
  AUTH_STATE_TTL_MS,
  clearAuthStateCookie,
  openPayload,
  sessionCookie,
  type AdminSession,
} from '@/server/session'
import { authenticateWithCode } from '@/server/workos'
import { safeReturnTo } from '@/server/auth-redirect'

type AuthState = {
  issuedAt: number
  nonce: string
  returnTo: string
}

function redirectWithCookies(target: string, request: NextRequest, cookies: string[]): Response {
  const response = NextResponse.redirect(new URL(target, request.nextUrl.origin))
  for (const cookie of cookies) {
    response.headers.append('Set-Cookie', cookie)
  }
  return response
}

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get('code')
  const returnedState = request.nextUrl.searchParams.get('state')
  const stored = openPayload<AuthState>(request.cookies.get(ADMIN_AUTH_STATE_COOKIE)?.value)

  if (!code || !stored || !returnedState || returnedState !== stored.nonce
    || Date.now() - stored.issuedAt > AUTH_STATE_TTL_MS) {
    return redirectWithCookies('/sign-in?error=state', request, [clearAuthStateCookie()])
  }

  let tokens: Awaited<ReturnType<typeof authenticateWithCode>>
  try {
    tokens = await authenticateWithCode(code)
  } catch {
    return redirectWithCookies('/sign-in?error=auth', request, [clearAuthStateCookie()])
  }

  // Gate before issuing a session: allowlist + active principal row.
  if (!allowedUserIds().has(tokens.user.id)) {
    return redirectWithCookies('/denied?reason=allowlist', request, [clearAuthStateCookie()])
  }
  const principal = await adminConvexQuery<AdministrativePrincipal | null>(
    'admin/administration:getPrincipalByServer',
    { userId: tokens.user.id },
  ).catch(() => null)
  if (!principal || principal.revokedAt !== undefined) {
    return redirectWithCookies('/denied?reason=principal', request, [clearAuthStateCookie()])
  }

  const now = Date.now()
  const session: AdminSession = {
    accessToken: tokens.accessToken,
    lastActiveAt: now,
    refreshToken: tokens.refreshToken ?? null,
    signedInAt: now,
    user: {
      email: tokens.user.email,
      firstName: tokens.user.firstName,
      id: tokens.user.id,
      lastName: tokens.user.lastName,
    },
  }

  return redirectWithCookies(safeReturnTo(stored.returnTo, request.nextUrl.origin), request, [
    sessionCookie(session),
    clearAuthStateCookie(),
  ])
}
