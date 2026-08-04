import { logger } from '@/server/observability/logger'
import { NextRequest, NextResponse } from 'next/server'
import { unstable_rethrow } from 'next/navigation'
import { getOverlaySession } from '@/server/auth/session'
import { enforceRateLimits, getClientIp } from '@/server/security/rate-limit'
import { requireOverlayCapability } from '@/server/capabilities'
import { billingCheckoutService, billingErrorResponse } from '@/server/billing/http'
import { getOverlayServerContext } from '@/server/bootstrap'

export async function POST(request: NextRequest) {
  try {
    const disabledCapabilityResponse = await requireOverlayCapability('billing')
    if (disabledCapabilityResponse) return disabledCapabilityResponse

    const body = await request.json().catch((_error) => ({}))
    const authSession = await getOverlaySession(request)
    if (!authSession) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
    }
    if (
      request.headers.get('origin') !== request.nextUrl.origin ||
      request.headers.get('sec-fetch-site') === 'cross-site'
    ) {
      return NextResponse.json({ error: 'Invalid request origin' }, { status: 403 })
    }
    if (
      !body ||
      typeof body !== 'object' ||
      body.confirmation !== 'OPEN_BILLING_PORTAL'
    ) {
      return NextResponse.json({ error: 'Billing portal confirmation required' }, { status: 403 })
    }
    const userId = authSession.user.id

    const rateLimitResponse = await enforceRateLimits(request, [
      { bucket: 'billing:portal:ip', key: getClientIp(request), limit: 10, windowMs: 10 * 60_000 },
      { bucket: 'billing:portal:user', key: userId, limit: 5, windowMs: 10 * 60_000 },
    ])
    if (rateLimitResponse) return rateLimitResponse

    await getOverlayServerContext().auditService.record({
      action: 'billing.portal.open.requested',
      actorType: 'user',
      actorUserId: userId,
      ipAddress: getClientIp(request),
      outcome: 'success',
      resourceId: userId,
      resourceType: 'billing_portal',
    })
    const result = await billingCheckoutService.createPortalSession({
      userId,
      userEmail: authSession.user.email,
      accessToken: authSession.accessToken,
      body,
    })
    return NextResponse.json(result)
  } catch (error) {
    unstable_rethrow(error)
    if (error instanceof Error && error.name === 'BillingServiceError') {
      return billingErrorResponse(error, 'Failed to create portal session')
    }
    logger.error('Portal error:', error)
    return NextResponse.json(
      { error: 'Failed to create portal session' },
      { status: 500 },
    )
  }
}
