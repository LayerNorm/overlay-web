import { cookies } from 'next/headers'
import { NextResponse, type NextRequest } from 'next/server'
import { authenticateAdminWithCode } from '@/server/workos'
import {
  ADMIN_OAUTH_STATE_COOKIE,
  ADMIN_SESSION_COOKIE,
  decodeOAuthState,
  encodeAdminSession,
  newAdminSessionPayload,
} from '@/server/session'

/**
 * WorkOS redirects back here with `code` + `state`. We verify the state
 * matches the signed cookie verbatim (blocks CSRF and stale flows), exchange
 * the code for tokens, then mint the `__Host-overlay_admin_session` cookie.
 * The operator gate on each admin surface still enforces allowlist +
 * principal afterwards.
 */
export async function GET(request: NextRequest) {
  const origin = request.nextUrl.origin
  const code = request.nextUrl.searchParams.get('code')
  const state = request.nextUrl.searchParams.get('state')

  const cookieStore = await cookies()
  const rawStateCookie = cookieStore.get(ADMIN_OAUTH_STATE_COOKIE)?.value
  const expected = decodeOAuthState(rawStateCookie)
  cookieStore.delete(ADMIN_OAUTH_STATE_COOKIE)

  if (!code || !state || !expected || !rawStateCookie || state !== rawStateCookie) {
    return NextResponse.redirect(`${origin}/signin?error=oauth_state`)
  }

  try {
    const { accessToken, refreshToken, user } = await authenticateAdminWithCode(code)
    const session = encodeAdminSession(
      newAdminSessionPayload({
        accessToken,
        refreshToken: refreshToken ?? null,
        user: {
          id: user.id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
        },
      }),
    )
    const response = NextResponse.redirect(`${origin}${expected.returnTo}`)
    response.cookies.set(ADMIN_SESSION_COOKIE, session, {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 8 * 60 * 60,
    })
    return response
  } catch {
    return NextResponse.redirect(`${origin}/signin?error=oauth_exchange`)
  }
}
