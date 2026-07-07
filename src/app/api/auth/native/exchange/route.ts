import { NextRequest, NextResponse } from 'next/server'
import { authenticateNativeWithCode } from '@/server/auth/actions'
import { convex } from '@/server/database/convex'
import { getInternalApiSecret } from '@/server/shared/internal-api-secret'
import { enforceRateLimits, getClientIp } from '@/server/security/rate-limit'
import { logSecurityEvent } from '@/server/observability/security-events'
import {
  isValidNativeAuthCode,
  isValidPkceVerifier,
} from '@/server/auth/native-auth-validation'
import { requireOverlayCapability } from '@/server/capabilities'

const NO_STORE_HEADERS = {
  'Cache-Control': 'no-store, max-age=0',
  Pragma: 'no-cache',
} as const

export async function POST(request: NextRequest) {
  try {
    const disabledCapabilityResponse = await requireOverlayCapability('sso')
    if (disabledCapabilityResponse) return disabledCapabilityResponse

    const rateLimitResponse = await enforceRateLimits(request, [
      { bucket: 'auth:native-exchange:ip', key: getClientIp(request), limit: 20, windowMs: 10 * 60_000 },
    ])
    if (rateLimitResponse) return rateLimitResponse

    const body = await request.json().catch((_error) => ({})) as {
      code?: unknown
      codeVerifier?: unknown
    }

    const code = typeof body.code === 'string' ? body.code.trim() : ''
    const codeVerifier = typeof body.codeVerifier === 'string' ? body.codeVerifier.trim() : ''

    if (!isValidNativeAuthCode(code) || !isValidPkceVerifier(codeVerifier)) {
      logSecurityEvent('native_exchange_rejected', {
        reason: !isValidNativeAuthCode(code) ? 'invalid_code' : 'invalid_code_verifier',
        path: request.nextUrl.pathname,
        ip: getClientIp(request),
      }, 'warning')
      return NextResponse.json({ error: 'Missing authorization code or verifier' }, { status: 400, headers: NO_STORE_HEADERS })
    }

    const session = await authenticateNativeWithCode(code, codeVerifier)

    await convex.mutation('auth/users:syncUserProfileByServer', {
      serverSecret: getInternalApiSecret(),
      userId: session.user.id,
      email: session.user.email,
      firstName: session.user.firstName,
      lastName: session.user.lastName,
      profilePictureUrl: session.user.profilePictureUrl,
    }, { throwOnError: true })

    return NextResponse.json({ success: true, session }, { headers: NO_STORE_HEADERS })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    logSecurityEvent('native_exchange_error', {
      reason: message,
      path: request.nextUrl.pathname,
      ip: getClientIp(request),
    }, 'warning')
    if (message.startsWith('Native Better Auth')) {
      return NextResponse.json({ error: message }, { status: 400, headers: NO_STORE_HEADERS })
    }
    return NextResponse.json({ error: 'Failed to complete native sign-in' }, { status: 500, headers: NO_STORE_HEADERS })
  }
}
