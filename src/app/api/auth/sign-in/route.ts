import { logger } from '@/server/observability/logger'
import { NextRequest, NextResponse } from 'next/server'
import { authenticateWithPassword } from '@/server/auth/actions'
import { enforceRateLimits, getClientIp, rateLimitByIp } from '@/server/security/rate-limit'

export async function POST(request: NextRequest) {
  try {
    // First-line reject: per-IP limit (cheap, runs before body parse).
    const ipLimitResponse = await rateLimitByIp(request, 'auth:sign-in:ip', 10, 60_000)
    if (ipLimitResponse) return ipLimitResponse

    const body = await request.json()
    const { email, password } = body

    if (!email || !password) {
      return NextResponse.json(
        { error: 'Email and password are required' },
        { status: 400 }
      )
    }

    // Per-email limit: defeats distributed credential stuffing (botnet spreading
    // attempts across IPs against a single account). 5 failures per 15 minutes.
    const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : ''
    const emailLimitResponse = await enforceRateLimits(request, [
      { bucket: 'auth:sign-in:email', key: normalizedEmail, limit: 5, windowMs: 15 * 60_000 },
      // Re-check IP as part of the combined rule for security logging consistency.
      { bucket: 'auth:sign-in:ip-combined', key: getClientIp(request), limit: 20, windowMs: 60_000 },
    ])
    if (emailLimitResponse) return emailLimitResponse

    const result = await authenticateWithPassword(email, password)

    if (result.pendingEmailVerification) {
      return NextResponse.json(
        {
          error: result.error,
          pendingEmailVerification: true,
          ...(result.verificationTicket ? { verificationTicket: result.verificationTicket } : {}),
        },
        { status: 403 }
      )
    }

    if (!result.success) {
      return NextResponse.json(
        { error: result.error || 'Authentication failed' },
        { status: 401 }
      )
    }

    return NextResponse.json({
      success: true,
      user: result.user,
    })
  } catch (error) {
    logger.error('[Auth] Sign-in error:', error)
    return NextResponse.json(
      { error: 'An unexpected error occurred' },
      { status: 500 }
    )
  }
}
