import 'server-only'

import type { AdministrativePrincipal } from './admin/AdministrativeRepository'
import { adminConvexQuery, runWithOperatorAccessToken } from './convex-admin'
import { allowedUserIds } from './env'
import {
  hasRecentSignIn,
  openSession,
  sessionStatus,
  type AdminSession,
  type AdminSessionUser,
} from './session'
import { refreshSession } from './workos'

export type OperatorResolution =
  | { kind: 'anonymous'; reason: 'expired' | 'idle_expired' | 'invalid' | 'missing' }
  | { kind: 'denied'; reason: 'not_allowlisted' | 'not_operator' }
  | {
      kind: 'operator'
      principal: AdministrativePrincipal
      session: AdminSession
      sessionMutated: boolean
      user: AdminSessionUser
    }

/**
 * WorkOS access tokens are JWTs; treat a token within this skew of expiry as
 * stale enough to refresh.
 */
const TOKEN_REFRESH_SKEW_MS = 60_000

function accessTokenExpiring(token: string, now: number = Date.now()): boolean {
  try {
    const payload = JSON.parse(
      Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8'),
    ) as { exp?: number }
    if (typeof payload.exp !== 'number') return false
    return payload.exp * 1000 - now <= TOKEN_REFRESH_SKEW_MS
  } catch {
    return false
  }
}

type OperatorDeps = {
  getPrincipal?: (userId: string) => Promise<AdministrativePrincipal | null>
}

async function loadPrincipal(userId: string) {
  return adminConvexQuery<AdministrativePrincipal | null>(
    'admin/console:getPrincipal',
    { userId },
  )
}

/**
 * Resolves the caller to an operator context. Access requires all three:
 * a valid session, membership in ADMIN_ALLOWED_USER_IDS, and an active
 * `administrativePrincipals` row.
 */
export async function resolveOperator(
  cookieValue: string | undefined,
  deps: OperatorDeps = {},
): Promise<OperatorResolution> {
  const getPrincipal = deps.getPrincipal ?? loadPrincipal
  const session = openSession(cookieValue)
  if (!session) {
    return { kind: 'anonymous', reason: cookieValue ? 'invalid' : 'missing' }
  }
  const status = sessionStatus(session)
  if (status !== 'active') {
    return { kind: 'anonymous', reason: status }
  }

  let sessionMutated = false
  if (session.refreshToken && accessTokenExpiring(session.accessToken)) {
    try {
      const refreshed = await refreshSession(session.refreshToken)
      session.accessToken = refreshed.accessToken
      session.refreshToken = refreshed.refreshToken ?? session.refreshToken
      sessionMutated = true
    } catch {
      // The access token is only needed to forward identity to Convex in a
      // later stage; a refresh failure does not invalidate the session.
    }
  }

  if (!allowedUserIds().has(session.user.id)) {
    return { kind: 'denied', reason: 'not_allowlisted' }
  }

  const principal = await runWithOperatorAccessToken(session.accessToken, async () =>
    await getPrincipal(session.user.id),
  ).catch(() => null)
  if (!principal || principal.revokedAt) {
    return { kind: 'denied', reason: 'not_operator' }
  }

  return { kind: 'operator', principal, session, sessionMutated, user: session.user }
}

export { hasRecentSignIn }
