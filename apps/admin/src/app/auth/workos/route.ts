import { cookies } from 'next/headers'
import { NextResponse, type NextRequest } from 'next/server'
import { adminAuthorizationUrl } from '@/server/workos'
import { ADMIN_OAUTH_STATE_COOKIE, encodeOAuthState } from '@/server/session'

/**
 * Starts the WorkOS AuthKit sign-in. Plain language: we stash a signed
 * 10-minute state cookie (binds the callback to this sign-in and remembers
 * where to land), then hand the browser off to WorkOS's hosted sign-in.
 */
export async function GET(request: NextRequest) {
  const returnTo = request.nextUrl.searchParams.get('returnTo') ?? '/'
  const safeReturnTo = returnTo.startsWith('/') && !returnTo.startsWith('//') ? returnTo : '/'
  const state = encodeOAuthState(safeReturnTo)
  const redirectUri = `${request.nextUrl.origin}/auth/callback`

  const cookieStore = await cookies()
  cookieStore.set(ADMIN_OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 10 * 60,
  })

  return NextResponse.redirect(adminAuthorizationUrl(redirectUri, state))
}
