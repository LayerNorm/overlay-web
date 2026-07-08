import { logger } from '@/server/observability/logger'
import { NextRequest, NextResponse } from 'next/server'

import { AccountDeletionService } from '@/server/account/AccountDeletionService'
import { resolveAuthenticatedAppUser } from '@/server/auth/app-api-auth'
import { clearOverlaySession, getOverlaySession } from '@/server/auth/session'
import { getOverlayServerContext } from '@/server/bootstrap'
import { enforceRateLimits, getClientIp } from '@/server/security/rate-limit'

/**
 * POST /api/account/delete
 *
 * Permanently deletes the authenticated user. The route is intentionally a thin
 * controller; provider-specific Convex/R2/Stripe/auth-provider work lives
 * behind the server context adapters and the account service.
 */
export async function POST(request: NextRequest) {
  const session = await getOverlaySession(request)
  const body = await request.json().catch((_error) => ({}))
  const auth = await resolveAuthenticatedAppUser(request, body)
  if (!auth) {
    return NextResponse.json({ error: 'Not signed in' }, { status: 401 })
  }

  const userId = auth.userId
  const userEmail = session?.user?.id === userId ? session.user.email : undefined
  const rateLimitResponse = await enforceRateLimits(request, [
    { bucket: 'account:delete:ip', key: getClientIp(request), limit: 5, windowMs: 60 * 60_000 },
    { bucket: 'account:delete:user', key: userId, limit: 2, windowMs: 60 * 60_000 },
  ])
  if (rateLimitResponse) return rateLimitResponse

  let result: Awaited<ReturnType<AccountDeletionService['deleteAccount']>>
  try {
    result = await new AccountDeletionService(getOverlayServerContext()).deleteAccount({ userId, request })
  } catch (error) {
    logger.error('[account/delete] Account deletion failed:', error)
    return NextResponse.json(
      {
        error: 'Could not delete your account data. Please try again or contact support@getoverlay.io.',
      },
      { status: 500 },
    )
  }

  logger.info(
    `[account/delete] Account purge complete for ${userId} (${userEmail}): ${result.deletedRowCount} rows`,
  )

  if (session?.user?.id === userId) {
    await clearOverlaySession(request)
  }

  return NextResponse.json({
    success: true,
    deletedRowCount: result.deletedRowCount,
  })
}
