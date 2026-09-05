import { unstable_rethrow } from 'next/navigation'
import { NextRequest, NextResponse } from 'next/server'
import { getOverlaySession } from '@/server/auth/session'
import { billingCheckoutService, billingErrorResponse } from '@/server/billing/http'
import { getOverlayServerContext } from '@/server/bootstrap'
import { requireOverlayCapability } from '@/server/capabilities'
import { enforceRateLimits, getClientIp } from '@/server/security/rate-limit'

export async function POST(request: NextRequest) {
  try {
    const disabledCapabilityResponse = await requireOverlayCapability('billing')
    if (disabledCapabilityResponse) return disabledCapabilityResponse

    const session = await getOverlaySession(request)
    if (!session?.user) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
    }
    if (!isSameOriginMutation(request)) {
      return NextResponse.json({ error: 'Invalid request origin' }, { status: 403 })
    }

    const rateLimitResponse = await enforceRateLimits(request, [
      { bucket: 'billing:plan-change:ip', key: getClientIp(request), limit: 20, windowMs: 10 * 60_000 },
      { bucket: 'billing:plan-change:user', key: session.user.id, limit: 10, windowMs: 10 * 60_000 },
    ])
    if (rateLimitResponse) return rateLimitResponse

    const body = await request.json().catch((_error) => null)
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
    }

    const result = await billingCheckoutService.changeSubscriptionPlan({
      body,
      userId: session.user.id,
    })
    if (result.mode === 'confirmed') {
      await getOverlayServerContext().auditService.record({
        action: 'billing.plan.change.confirmed',
        actorType: 'user',
        actorUserId: session.user.id,
        ipAddress: getClientIp(request),
        outcome: 'success',
        resourceId: session.user.id,
        resourceType: 'billing_subscription',
      })
    }
    return NextResponse.json(result)
  } catch (error) {
    unstable_rethrow(error)
    return billingErrorResponse(error, 'Failed to change subscription plan')
  }
}

function isSameOriginMutation(request: NextRequest): boolean {
  return (
    request.headers.get('origin') === request.nextUrl.origin &&
    request.headers.get('sec-fetch-site') !== 'cross-site'
  )
}
