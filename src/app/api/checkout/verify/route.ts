import { logger } from '@/server/observability/logger'
import { NextRequest, NextResponse } from 'next/server'
import { getOverlaySession } from '@/server/auth/session'
import { requireOverlayCapability } from '@/server/capabilities'
import { billingCheckoutService, billingErrorResponse } from '@/server/billing/http'

export async function POST(request: NextRequest) {
  try {
    const disabledCapabilityResponse = await requireOverlayCapability('billing')
    if (disabledCapabilityResponse) return disabledCapabilityResponse

    const authSession = await getOverlaySession(request)

    if (!authSession || !authSession.user) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      )
    }

    const { sessionId } = await request.json()
    const result = await billingCheckoutService.verifySubscriptionCheckout({
      userId: authSession.user.id,
      sessionId,
    })
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof Error && error.name === 'BillingServiceError') {
      return billingErrorResponse(error, 'Failed to verify checkout')
    }
    logger.error('[Checkout Verify] Error:', error)
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json(
      { error: `Failed to verify checkout: ${errorMessage}` },
      { status: 500 }
    )
  }
}
