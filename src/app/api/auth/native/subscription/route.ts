import { logger } from '@/server/observability/logger'
import { NextRequest, NextResponse } from 'next/server'
import { unstable_rethrow } from 'next/navigation'
import { resolveAuthenticatedAppUser } from '@/server/auth/app-api-auth'
import { getOverlayServerContext } from '@/server/bootstrap'
import { rateLimitByIp } from '@/server/security/rate-limit'
import { buildNativeSubscriptionResponse } from '@/server/billing/native-subscription-response'

const NO_STORE_HEADERS = {
  'Cache-Control': 'no-store, max-age=0',
  Pragma: 'no-cache',
} as const

const INVALID_TOKEN_HEADERS = {
  ...NO_STORE_HEADERS,
  'WWW-Authenticate': 'Bearer error="invalid_token"',
} as const

async function getAuthenticatedUserId(request: NextRequest): Promise<string | null> {
  return (await resolveAuthenticatedAppUser(request, {}))?.userId ?? null
}

export async function GET(request: NextRequest) {
  try {
    const rateLimitResponse = await rateLimitByIp(request, 'auth:native-subscription:ip', 60, 60_000)
    if (rateLimitResponse) return rateLimitResponse
    const userId = await getAuthenticatedUserId(request)
    if (!userId) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401, headers: INVALID_TOKEN_HEADERS }
      )
    }

    const entitlements = await getOverlayServerContext().appData.repositories.usage
      .getEntitlements({ userId })

    if (!entitlements) {
      return NextResponse.json(
        { error: 'Failed to load subscription' },
        { status: 502, headers: NO_STORE_HEADERS }
      )
    }

    return NextResponse.json(
      buildNativeSubscriptionResponse(entitlements),
      { headers: NO_STORE_HEADERS },
    )
  } catch (error) {
    unstable_rethrow(error)
    logger.error('[NativeSubscription] Error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch subscription' },
      { status: 500, headers: NO_STORE_HEADERS }
    )
  }
}
