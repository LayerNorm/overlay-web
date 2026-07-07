import { logger } from '@/server/observability/logger'
import { NextRequest, NextResponse } from 'next/server'
import { getOverlaySession } from '@/server/auth/session'
import { requireOverlayCapability } from '@/server/capabilities'
import { billingCustomerService, billingErrorResponse } from '@/server/billing/http'

export async function GET(request: NextRequest) {
  const disabledCapabilityResponse = await requireOverlayCapability('billing')
  if (disabledCapabilityResponse) return disabledCapabilityResponse

  const session = await getOverlaySession(request)
  if (!session || !session.user) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const userId = searchParams.get('userId')

  if (!userId) {
    return NextResponse.json({ error: 'userId is required' }, { status: 400 })
  }

  if (userId !== session.user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
    const response = await billingCustomerService.getLandingSubscription({ userId })
    return NextResponse.json(response)
  } catch (error) {
    if (error instanceof Error && error.name === 'BillingServiceError') {
      return billingErrorResponse(error, 'Failed to fetch subscription')
    }
    logger.error('[Subscription API] Error fetching subscription:', error)
    return NextResponse.json({ error: 'Failed to fetch subscription' }, { status: 500 })
  }
}
