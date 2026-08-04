import { logger } from '@/server/observability/logger'
import { NextResponse } from 'next/server'
import { unstable_rethrow } from 'next/navigation'
import { logAuthDebug, summarizeSessionForLog } from '@/server/auth/auth-debug'
import { getOverlaySession } from '@/server/auth/session'
import { billingCustomerService, billingErrorResponse } from '@/server/billing/http'

export async function GET(request: Request) {
  try {
    const session = await getOverlaySession(request)
    logAuthDebug('/api/entitlements getSession result', summarizeSessionForLog(session))
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const userId = session.user.id

    try {
      logAuthDebug('/api/entitlements first attempt start', {
        userId,
        session: summarizeSessionForLog(session),
      })
      const entitlements = await billingCustomerService.getEntitlements({ userId })
      logAuthDebug('/api/entitlements success', {
        userId,
        tier: entitlements.tier,
      })
      return NextResponse.json(entitlements)
    } catch (error) {
      if (error instanceof Error && error.name === 'BillingServiceError') {
        if ((error as { statusCode?: number }).statusCode === 502) {
          return billingErrorResponse(error, 'Failed to fetch entitlements')
        }
      }
      const msg = error instanceof Error ? error.message : String(error)
      logAuthDebug('/api/entitlements first attempt error', {
        userId,
        error: msg,
        session: summarizeSessionForLog(session),
      })
      logger.error('Entitlements error:', error)
      return NextResponse.json({ error: 'Failed to fetch entitlements' }, { status: 500 })
    }
  } catch (error) {
    unstable_rethrow(error)
    logAuthDebug('/api/entitlements outer error', {
      error: error instanceof Error ? error.message : String(error),
    })
    logger.error('Entitlements error:', error)
    return NextResponse.json({ error: 'Failed to fetch entitlements' }, { status: 500 })
  }
}
