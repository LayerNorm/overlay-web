import 'server-only'

import { unstable_noStore as noStore } from 'next/cache'
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
  request: Request = FALLBACK_SESSION_REQUEST,
  options: { refresh?: boolean } = {},
): Promise<AuthSession | null> {
  noStore()
  const auth = getOverlayServerContext().auth
  const session = options.refresh && auth.refreshSession
    ? await auth.refreshSession(request)
    : await auth.getSession(request)
  return session ? toAuthSession(session) : null
}

export async function clearOverlaySession(
  request: Request = FALLBACK_SESSION_REQUEST,
): Promise<void> {
  const auth = getOverlayServerContext().auth
  if (auth.signOut) {
    await auth.signOut(request)
    return
  }

  const { clearSession } = await import('@/server/auth/workos-auth')
  await clearSession()
}
