import { logger } from '@/server/observability/logger'
import { NextRequest, NextResponse } from 'next/server'
import { unstable_rethrow } from 'next/navigation'
import { getOverlaySession } from '@/server/auth/session'
import { enforceRateLimits, getClientIp } from '@/server/security/rate-limit'
import { requireOverlayCapability } from '@/server/capabilities'
import { accountPlansRetiredResponse, billingErrorResponse } from '@/server/billing/http'

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
    // An account cannot be paid; workspace plans start from Workspace → Billing.
    return accountPlansRetiredResponse()
  } catch (error) {
    unstable_rethrow(error)
    logger.error('Checkout error:', error)
    return billingErrorResponse(error, 'Failed to create checkout session')
  }
}
