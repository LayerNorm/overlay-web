import 'server-only'

import { cookies } from 'next/headers'
import type { AdministrativePrincipal, AdministrativeRole } from '@/server/admin/AdministrativeRepository'
import { adminServices } from '@/server/bootstrap'
import { allowedAdminUserIds } from '@/server/env'
import { refreshAdminSession } from '@/server/workos'
import {
  ADMIN_SESSION_COOKIE,
  decodeAdminSession,
  encodeAdminSession,
  touchAdminSession,
  type AdminSessionPayload,
} from '@/server/session'

export type OperatorContext = {
  userId: string
  email: string
  accessToken: string
  principal: AdministrativePrincipal
  role: AdministrativeRole
  /** Capabilities resolved through the authorization subject (roles+groups). */
  capabilities: string[]
}

export type OperatorGateResult =
  | { ok: true; session: AdminSessionPayload; operator: OperatorContext }
  | { ok: false; reason: 'no-session' | 'not-allowlisted' | 'revoked' }

/**
 * The three-part gate every admin surface runs behind:
 *   1. valid WorkOS session cookie (HMAC + expiry + idle checks)
 *   2. ADMIN_ALLOWED_USER_IDS membership
 *   3. active `administrativePrincipals` row (not revoked)
 */
export async function checkOperator(opts: {
  /** When true the handler may write cookies (route handlers only). */
  mutableCookies?: boolean
} = {}): Promise<OperatorGateResult> {
  const cookieStore = await cookies()
  const session = decodeAdminSession(cookieStore.get(ADMIN_SESSION_COOKIE)?.value)
  if (!session) return { ok: false, reason: 'no-session' }

  const userId = session.user.id
  if (!allowedAdminUserIds().includes(userId)) {
    return { ok: false, reason: 'not-allowlisted' }
  }

  const { administrativeService, authorizationService } = adminServices()
  const principal = await administrativeService.activePrincipal(userId)
  if (!principal) return { ok: false, reason: 'revoked' }

  // Sliding idle renewal + lazy WorkOS token refresh. Only possible where the
  // runtime lets us write cookies (route handlers); page gates are read-only.
  let accessToken = session.accessToken
  if (opts.mutableCookies) {
    try {
      let next = touchAdminSession(session)
      if (session.refreshToken && isJwtExpired(session.accessToken)) {
        const refreshed = await refreshAdminSession(session.refreshToken)
        accessToken = refreshed.accessToken
        next = touchAdminSession({ ...next, accessToken, refreshToken: refreshed.refreshToken ?? next.refreshToken })
      }
      cookieStore.set(ADMIN_SESSION_COOKIE, encodeAdminSession(next), {
        httpOnly: true,
        secure: true,
        sameSite: 'lax',
        path: '/',
        maxAge: 8 * 60 * 60,
      })
    } catch {
      // Cookie writes are best-effort; a failed renew never gates the request.
    }
  }

  const subject = await authorizationService.resolveSubject(userId)
  return {
    ok: true,
    session,
    operator: {
      userId,
      email: session.user.email,
      accessToken,
      principal,
      role: principal.role,
      capabilities: subject.capabilities,
    },
  }
}

function isJwtExpired(token: string): boolean {
  try {
    const [, payloadB64] = token.split('.')
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'))
    return typeof payload.exp === 'number' && payload.exp * 1000 <= Date.now() + 30_000
  } catch {
    return true
  }
}
