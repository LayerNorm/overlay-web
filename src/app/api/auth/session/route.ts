import { logger } from '@/server/observability/logger'
import { NextRequest, NextResponse } from 'next/server'
import { logAuthDebug, summarizeSessionForLog } from '@/server/auth/auth-debug'
import { getOverlaySession } from '@/server/auth/session'
import { formatOverlayConfigError, isOverlayConfigError } from '@/server/config'
import { rateLimitByIp } from '@/server/security/rate-limit'

export const dynamic = 'force-dynamic'

const NO_STORE_HEADERS = {
  'Cache-Control': 'no-store, max-age=0',
  Vary: 'Cookie',
}

export async function GET(request: NextRequest) {
  try {
    const rateLimitResponse = await rateLimitByIp(request, 'auth:session', 60, 60_000)
    if (rateLimitResponse) return rateLimitResponse
    const session = await getOverlaySession(request, { refresh: true })
    if (!session) {
      logAuthDebug('/api/auth/session unauthenticated')
      return NextResponse.json(
        { authenticated: false },
        { status: 200, headers: NO_STORE_HEADERS },
      )
    }
    logAuthDebug('/api/auth/session authenticated', summarizeSessionForLog(session))
    return NextResponse.json({
      authenticated: true,
      user: session.user,
    }, { headers: NO_STORE_HEADERS })
  } catch (error) {
    if (isOverlayConfigError(error)) {
      const formatted = formatOverlayConfigError(error)
      return NextResponse.json(
        {
          authenticated: false,
          error: 'Runtime configuration is invalid',
          code: 'runtime_config_invalid',
          issues: formatted.issues,
        },
        { status: 503, headers: NO_STORE_HEADERS },
      )
    }

    logAuthDebug('/api/auth/session error', {
      error: error instanceof Error ? error.message : String(error),
    })
    logger.error('[Auth] Session check error:', error)
    return NextResponse.json(
      {
        authenticated: false,
        error: 'Session could not be resolved',
        code: 'session_resolution_failed',
      },
      { status: 503, headers: NO_STORE_HEADERS },
    )
  }
}
