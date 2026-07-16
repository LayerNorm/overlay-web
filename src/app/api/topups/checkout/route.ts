import { logger } from '@/server/observability/logger'
import { NextRequest, NextResponse } from 'next/server'
import { getOverlaySession } from '@/server/auth/session'
import { resolveAuthenticatedAppUser } from '@/server/auth/app-api-auth'
import { enforceRateLimits, getClientIp } from '@/server/security/rate-limit'
import { requireOverlayCapability } from '@/server/capabilities'
import { billingCheckoutService, billingErrorResponse } from '@/server/billing/http'

export async function POST(request: NextRequest) {
  try {
    const disabledCapabilityResponse = await requireOverlayCapability('billing')
    if (disabledCapabilityResponse) return disabledCapabilityResponse

    const body = await request.json()
    const session = await getOverlaySession(request)
    const auth = await resolveAuthenticatedAppUser(request, body)
    const userId = auth?.userId
    if (!userId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
    }
    const userEmail = session?.user?.id === userId ? session.user.email : undefined

    const rateLimitResponse = await enforceRateLimits(request, [
      { bucket: 'billing:topup:ip', key: getClientIp(request), limit: 10, windowMs: 10 * 60_000 },
      { bucket: 'billing:topup:user', key: userId, limit: 5, windowMs: 10 * 60_000 },
    ])
    if (rateLimitResponse) return rateLimitResponse

    const result = await billingCheckoutService.createTopUpCheckout({
      userId,
      userEmail,
      body,
    })
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof Error && error.name === 'BillingServiceError') {
      return billingErrorResponse(error, 'Failed to create top-up checkout')
    }
    logger.error('[TopUp Checkout] Error:', error)
    return NextResponse.json({ error: 'Failed to create top-up checkout' }, { status: 500 })
  }
}
