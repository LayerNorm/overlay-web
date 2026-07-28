import { logger } from '@/server/observability/logger'
import { NextRequest, NextResponse } from 'next/server'
import { refreshSessionFromRefreshTokenResult } from '@/server/auth/actions'
import { enforceRateLimits, getClientIp } from '@/server/security/rate-limit'
import { getNativeRefreshTokenBucketKey } from '@/server/auth/native-refresh-rate-limit'
import { requireOverlayCapability } from '@/server/capabilities'

const NO_STORE_HEADERS = {
  'Cache-Control': 'no-store, max-age=0',
  Pragma: 'no-cache',
} as const

export async function POST(request: NextRequest) {
  try {
    const disabledCapabilityResponse = await requireOverlayCapability('sso')
    if (disabledCapabilityResponse) return disabledCapabilityResponse

    const body = await request.json()
    const refreshToken = typeof body?.refreshToken === 'string' ? body.refreshToken : ''
    const expectedUserId =
      typeof body?.userId === 'string'
        ? body.userId
        : typeof body?.user?.id === 'string'
          ? body.user.id
          : undefined

    const clientIp = getClientIp(request)
    const tokenBucketKey = getNativeRefreshTokenBucketKey(refreshToken, clientIp)
    const rateLimitResponse = await enforceRateLimits(request, [
      { bucket: 'auth:native-refresh:ip', key: clientIp, limit: 20, windowMs: 10 * 60_000 },
      { bucket: 'auth:native-refresh:token', key: tokenBucketKey, limit: 12, windowMs: 10 * 60_000 },
    ])
    if (rateLimitResponse) return rateLimitResponse

    if (!refreshToken) {
      return NextResponse.json(
        { error: 'Refresh token is required' },
        { status: 400, headers: NO_STORE_HEADERS }
      )
    }

    const refreshResult = await refreshSessionFromRefreshTokenResult(
      refreshToken,
      expectedUserId,
    )

    if (refreshResult.status === 'invalid') {
      return NextResponse.json(
        {
          error: 'Invalid or expired refresh token',
          code: 'invalid_refresh_token',
        },
        { status: 401, headers: NO_STORE_HEADERS }
      )
    }

    if (refreshResult.status === 'unavailable') {
      return NextResponse.json(
        {
          error: 'Session refresh is temporarily unavailable',
          code: 'refresh_temporarily_unavailable',
        },
        { status: 503, headers: NO_STORE_HEADERS }
      )
    }

    if (refreshResult.status === 'unsupported') {
      return NextResponse.json(
        {
          error: 'Native session refresh is not supported by the configured auth provider',
          code: 'native_refresh_unsupported',
        },
        { status: 501, headers: NO_STORE_HEADERS }
      )
    }

    return NextResponse.json({
      success: true,
      session: refreshResult.session,
    }, { headers: NO_STORE_HEADERS })
  } catch (error) {
    logger.error('[Auth] Native refresh error:', error)
    return NextResponse.json(
      { error: 'An unexpected error occurred' },
      { status: 500, headers: NO_STORE_HEADERS }
    )
  }
}
