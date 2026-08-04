import 'server-only'

import { connection } from 'next/server'
import { cookies, headers } from 'next/headers'
import { getOverlayServerContext } from '@/server/bootstrap'
import type { Session } from '@overlay/app-core'
import type { AuthSession } from '@/shared/auth/session-types'

const FALLBACK_SESSION_REQUEST = new Request('http://overlay.local/session')

function toAuthSession(session: Session): AuthSession | null {
  // A session is authenticated when it resolves to a real user with an access
  // token. This must match what the BFF (`resolveAuthenticatedAppUser`) treats
  // as authenticated, otherwise the UI can render the "sign in" nudge/gate while
  // API calls (e.g. the conversation list) succeed — making it look like you're
  // both signed in and signed out at the same time.
  //
  // `refreshToken`/`expiresAt` are carried through when present (needed for
  // session transfer to the desktop/mobile apps), but their absence no longer
  // downgrades the session to "guest".
  if (!session.user?.id || !session.accessToken) {
    return null
  }

  return {
    accessToken: session.accessToken,
    refreshToken: session.refreshToken ?? '',
    expiresAt: typeof session.expiresAt === 'number' ? session.expiresAt : 0,
    user: {
      id: session.user.id,
      email: session.user.email,
      firstName: session.user.firstName,
      lastName: session.user.lastName,
      profilePictureUrl: session.user.profilePictureUrl,
      emailVerified: session.user.emailVerified ?? false,
    },
  }
}

export async function getOverlaySession(
  request?: Request,
  options: { refresh?: boolean } = {},
): Promise<AuthSession | null> {
  await connection()
  const sessionRequest = request ?? await requestFromCurrentHeaders()
  const auth = getOverlayServerContext().auth
  const session = options.refresh && auth.refreshSession
    ? await auth.refreshSession(sessionRequest)
    : await auth.getSession(sessionRequest)
  return session ? toAuthSession(session) : null
}

export async function clearOverlaySession(
  request?: Request,
): Promise<Response | Headers | void> {
  const sessionRequest = request ?? await requestFromCurrentHeaders()
  const auth = getOverlayServerContext().auth
  if (auth.signOut) {
    return await auth.signOut(sessionRequest)
  }

  const { clearSession } = await import('@/server/auth/workos-auth')
  await clearSession()
}

async function requestFromCurrentHeaders(): Promise<Request> {
  try {
    const headerList = await headers()
    const currentHeaders = new Headers(headerList)
    const currentCookies = await cookies()
    const cookieHeader = currentCookies
      .getAll()
      .map((cookie) => `${cookie.name}=${cookie.value}`)
      .join('; ')
    if (cookieHeader) {
      currentHeaders.set('cookie', cookieHeader)
    }
    const host = currentHeaders.get('x-forwarded-host') ?? currentHeaders.get('host') ?? 'overlay.local'
    const proto = currentHeaders.get('x-forwarded-proto') ?? (host.includes('localhost') ? 'http' : 'https')
    return new Request(`${proto}://${host}/session`, {
      headers: currentHeaders,
    })
  } catch (_error) {
    return FALLBACK_SESSION_REQUEST
  }
}
