import { logger } from '@/server/observability/logger'
import { NextRequest, NextResponse } from 'next/server'
import { unstable_rethrow } from 'next/navigation'
import { resolveAuthenticatedAppUser } from '@/server/auth/app-api-auth'
import { enforceRateLimits, getClientIp } from '@/server/security/rate-limit'
import { requireOverlayCapability } from '@/server/capabilities'
import { accountPlansRetiredResponse, billingErrorResponse } from '@/server/billing/http'

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
      { bucket: 'billing:topup:ip', key: getClientIp(request), limit: 10, windowMs: 10 * 60_000 },
      { bucket: 'billing:topup:user', key: userId, limit: 5, windowMs: 10 * 60_000 },
    ])
    if (rateLimitResponse) return rateLimitResponse
    // Credit belongs to workspaces; top-ups are added from Workspace → Billing.
    return accountPlansRetiredResponse()
  } catch (error) {
    unstable_rethrow(error)
    logger.error('[TopUp Checkout] Error:', error)
    return billingErrorResponse(error, 'Failed to create top-up checkout')
  }
}
