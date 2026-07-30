import { NextRequest, NextResponse } from 'next/server'
import { resolveAuthenticatedAppUser } from '@/server/auth/app-api-auth'
import { getOverlaySession } from '@/server/auth/session'
import { requireOverlayCapability } from '@/server/capabilities'
import { billingCustomerService, billingErrorResponse } from '@/server/billing/http'
import { getOverlayServerContext } from '@/server/bootstrap'
import { getClientIp } from '@/server/security/rate-limit'

export async function GET(request: NextRequest) {
  const disabledCapabilityResponse = await requireOverlayCapability('billing')
  if (disabledCapabilityResponse) return disabledCapabilityResponse

  const auth = await resolveAuthenticatedAppUser(request, {})
  if (!auth) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  }

  const response = await billingCustomerService.getBillingSettings({ userId: auth.userId })
  return NextResponse.json(response)
}

export async function POST(request: NextRequest) {
  const disabledCapabilityResponse = await requireOverlayCapability('billing')
  if (disabledCapabilityResponse) return disabledCapabilityResponse

  const body = await request.json().catch((_error) => null)
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }
  const session = await getOverlaySession(request)
  if (!session) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  }
  if (!isSameOriginMutation(request)) {
    return NextResponse.json({ error: 'Invalid request origin' }, { status: 403 })
  }
  if (!('confirmation' in body) || body.confirmation !== 'UPDATE_BILLING_SETTINGS') {
    return NextResponse.json({ error: 'Billing settings confirmation required' }, { status: 403 })
  }

  try {
    const server = getOverlayServerContext()
    await server.auditService.record({
      action: 'billing.settings.update.requested',
      actorType: 'user',
      actorUserId: session.user.id,
      ipAddress: getClientIp(request),
      outcome: 'success',
      resourceId: session.user.id,
      resourceType: 'billing_settings',
    })
    const result = await billingCustomerService.updateBillingSettings({
      userId: session.user.id,
      body,
    })
    return NextResponse.json(result)
  } catch (error) {
    return billingErrorResponse(error, 'Failed to update billing settings')
  }
}

function isSameOriginMutation(request: NextRequest): boolean {
  return (
    request.headers.get('origin') === request.nextUrl.origin &&
    request.headers.get('sec-fetch-site') !== 'cross-site'
  )
}
