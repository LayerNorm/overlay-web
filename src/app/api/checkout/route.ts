import { logger } from '@/server/observability/logger'
import { NextRequest, NextResponse } from 'next/server'
import { unstable_rethrow } from 'next/navigation'
import { getOverlaySession } from '@/server/auth/session'
import { enforceRateLimits, getClientIp } from '@/server/security/rate-limit'
import { requireOverlayCapability } from '@/server/capabilities'
import { billingCheckoutService, billingErrorResponse } from '@/server/billing/http'
import {
  recordLegalAcceptance,
  requireCurrentLegalAcceptance,
} from '@/server/legal/legal-acceptance'

export async function POST(request: NextRequest) {
  try {
    const disabledCapabilityResponse = await requireOverlayCapability('billing')
    if (disabledCapabilityResponse) return disabledCapabilityResponse

    const session = await getOverlaySession(request)

    if (!session || !session.user) {
      return NextResponse.json(
        { error: 'Authentication required. Please sign in to subscribe.' },
        { status: 401 }
      )
    }

    const { user } = session
    const rateLimitResponse = await enforceRateLimits(request, [
      { bucket: 'billing:checkout:ip', key: getClientIp(request), limit: 10, windowMs: 10 * 60_000 },
      { bucket: 'billing:checkout:user', key: user.id, limit: 5, windowMs: 10 * 60_000 },
    ])
    if (rateLimitResponse) return rateLimitResponse

    const body = await request.json()
    const legalAcceptance = requireCurrentLegalAcceptance(body)
    await recordLegalAcceptance({
      acceptance: legalAcceptance,
      context: 'subscription_checkout',
      request,
      userId: user.id,
    })
    const result = await billingCheckoutService.createSubscriptionCheckout({
      user,
      body,
    })
    return NextResponse.json(result)
  } catch (error) {
    unstable_rethrow(error)
    logger.error('Checkout error:', error)
    return billingErrorResponse(error, 'Failed to create checkout session')
  }
}
