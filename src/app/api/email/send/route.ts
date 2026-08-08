import { logger } from '@/server/observability/logger'
import { NextRequest, NextResponse } from 'next/server'
import { rateLimitByIp } from '@/server/security/rate-limit'
import { sendEmail, getEmailProvider, isEmailConfigured } from '@/server/email/email-service'

/**
 * POST /api/email/send
 *
 * Sends a transactional email via the configured provider (Resend or SES).
 *
 * Body:
 *   to: string | string[]      — recipient(s)
 *   subject: string            — email subject
 *   html?: string              — HTML body
 *   text?: string              — plain text body
 *   from?: string              — override default from address
 *   replyTo?: string           — override default reply-to
 *
 * This route is intended for transactional emails triggered by the app.
 * Rate limited to 10 requests per minute per IP.
 */
export async function POST(request: NextRequest) {
  try {
    const rateLimitResponse = await rateLimitByIp(request, 'email:send', 10, 60_000)
    if (rateLimitResponse) return rateLimitResponse

    if (!isEmailConfigured()) {
      return NextResponse.json(
        { error: 'Email is not configured. Set RESEND_API_KEY or SES credentials.' },
        { status: 503 },
      )
    }

    const body = await request.json()
    const { to, subject, html, text, from, replyTo } = body

    if (!to || (typeof to !== 'string' && !Array.isArray(to))) {
      return NextResponse.json({ error: 'Recipient (to) is required' }, { status: 400 })
    }
    if (!subject || typeof subject !== 'string') {
      return NextResponse.json({ error: 'Subject is required' }, { status: 400 })
    }
    if (!html && !text) {
      return NextResponse.json({ error: 'Either html or text body is required' }, { status: 400 })
    }

    const result = await sendEmail({
      to,
      subject,
      html,
      text,
      from,
      replyTo,
    })

    if (!result.success) {
      return NextResponse.json(
        { error: result.error, provider: result.provider },
        { status: 502 },
      )
    }

    logger.info(`[Email] Sent via ${result.provider}: messageId=${result.messageId}`)
    return NextResponse.json({
      success: true,
      provider: result.provider,
      messageId: result.messageId,
    })
  } catch (error) {
    logger.error('[Email] Route error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to send email' },
      { status: 500 },
    )
  }
}

/**
 * GET /api/email/send
 *
 * Returns the current email provider configuration status.
 */
export async function GET() {
  return NextResponse.json({
    provider: getEmailProvider(),
    configured: isEmailConfigured(),
  })
}
