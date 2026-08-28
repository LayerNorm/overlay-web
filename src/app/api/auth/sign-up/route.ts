import { logger } from '@/server/observability/logger'
import { NextRequest, NextResponse } from 'next/server'
import { createUser } from '@/server/auth/actions'
import { enforceRateLimits, getClientIp, rateLimitByIp } from '@/server/security/rate-limit'
import {
  LegalAcceptanceError,
  recordLegalAcceptance,
  requireCurrentLegalAcceptance,
} from '@/server/legal/legal-acceptance'

export async function POST(request: NextRequest) {
  try {
    const rateLimitResponse = await rateLimitByIp(request, 'auth:sign-up', 5, 10 * 60_000)
    if (rateLimitResponse) return rateLimitResponse

    const body = await request.json()
    const { email, password, firstName, lastName } = body
    const legalAcceptance = requireCurrentLegalAcceptance(body)
    const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : ''

    if (!email || !password) {
      return NextResponse.json(
        { error: 'Email and password are required' },
        { status: 400 }
      )
    }

    // Basic password validation
    if (password.length < 8) {
      return NextResponse.json(
        { error: 'Password must be at least 8 characters' },
        { status: 400 }
      )
    }

    const emailLimitResponse = await enforceRateLimits(request, [
      { bucket: 'auth:sign-up:email', key: normalizedEmail, limit: 3, windowMs: 60 * 60_000 },
      { bucket: 'auth:sign-up:ip-combined', key: getClientIp(request), limit: 10, windowMs: 60 * 60_000 },
    ])
    if (emailLimitResponse) return emailLimitResponse

    const result = await createUser(email, password, firstName, lastName)

    if (!result.success) {
      return NextResponse.json(
        { error: 'If this email can be used, we will send the next step by email.' },
        { status: 400 }
      )
    }

    if (!result.user?.id) {
      throw new Error('Authentication provider did not return the created user ID')
    }

    await recordLegalAcceptance({
      acceptance: legalAcceptance,
      context: 'password_signup',
      request,
      userId: result.user.id,
    })

    return NextResponse.json({
      success: true,
      user: result.user,
      verificationTicket: result.verificationTicket,
      pendingEmailVerification: result.pendingEmailVerification,
      message: 'Account created! Please check your email to verify your account.',
    })
  } catch (error) {
    if (error instanceof LegalAcceptanceError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode })
    }
    logger.error('[Auth] Sign-up error:', error)
    return NextResponse.json(
      { error: 'An unexpected error occurred' },
      { status: 500 }
    )
  }
}
