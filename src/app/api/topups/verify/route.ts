import { logger } from '@/server/observability/logger'
import { NextRequest, NextResponse } from 'next/server'
import { unstable_rethrow } from 'next/navigation'
import { resolveAuthenticatedAppUser } from '@/server/auth/app-api-auth'
import { enforceRateLimits, getClientIp } from '@/server/security/rate-limit'
import { requireOverlayCapability } from '@/server/capabilities'
import { billingCheckoutService, billingErrorResponse } from '@/server/billing/http'

export async function POST(request: NextRequest) {
  try {
    const disabledCapabilityResponse = await requireOverlayCapability('billing')
    if (disabledCapabilityResponse) return disabledCapabilityResponse

    const body = await request.json()
    const auth = await resolveAuthenticatedAppUser(request, body)
    const userId = auth?.userId
    if (!userId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
    }

    const rateLimitResponse = await enforceRateLimits(request, [
      { bucket: 'billing:topup-verify:ip', key: getClientIp(request), limit: 20, windowMs: 10 * 60_000 },
      { bucket: 'billing:topup-verify:user', key: userId, limit: 10, windowMs: 10 * 60_000 },
    ])
    if (rateLimitResponse) return rateLimitResponse

    const result = await billingCheckoutService.verifyTopUp({
      userId,
      body,
    })
    return NextResponse.json(result)
  } catch (error) {
    unstable_rethrow(error)
    if (error instanceof Error && error.name === 'BillingServiceError') {
      return billingErrorResponse(error, 'Failed to verify top-up')
    }
    logger.error('[TopUp Verify] Error:', error)
    return NextResponse.json({ error: 'Failed to verify top-up' }, { status: 500 })
  }
}
