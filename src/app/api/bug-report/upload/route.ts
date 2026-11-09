import { randomUUID } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { resolveAuthenticatedAppUser } from '@/server/auth/app-api-auth'
import { getOverlayRuntimeConfigSync } from '@/server/config'
import { logger } from '@/server/observability/logger'
import { enforceRateLimits, getClientIp } from '@/server/security/rate-limit'
import { bugReportAttachmentKey, createBugReportUploadTicket, readBugReportJson } from '@/server/storage/bug-report-attachments'
import { generatePresignedUploadUrl } from '@/server/storage/object-store'
import { validBugReportFiles } from '@/shared/storage/bug-report'

export async function POST(request: NextRequest) {
  if (request.headers.get('origin') !== request.nextUrl.origin || request.headers.get('sec-fetch-site') === 'cross-site') {
    return NextResponse.json({ error: 'Invalid request origin.' }, { status: 403 })
  }
  const auth = await resolveAuthenticatedAppUser(request, {})
  if (!auth || auth.authType !== 'session') return NextResponse.json({ error: 'Sign in to report a bug.' }, { status: 401 })
  const limited = await enforceRateLimits(request, [
    { bucket: 'bug-report:upload:ip', key: getClientIp(request), limit: 10, windowMs: 60 * 60_000 },
    { bucket: 'bug-report:upload:user', key: auth.userId, limit: 3, windowMs: 60 * 60_000 },
  ])
  if (limited) return limited
  const config = getOverlayRuntimeConfigSync()
  if (!process.env.OVERLAY_BUG_REPORT_GITHUB_TOKEN || !process.env.OVERLAY_BUG_REPORT_EMAIL_TO || !config.email?.from || (config.providers.email?.provider ?? config.email?.provider) !== 'resend') {
    return NextResponse.json({ error: 'Bug reporting is not configured. Please try again later.' }, { status: 503 })
  }
  const body = await readBugReportJson(request)
  if (!validBugReportFiles(body?.files)) return NextResponse.json({ error: 'Attach up to 10 supported files, 5 MB in total (images, PDF, text, JSON, ZIP, or video).' }, { status: 400 })
  try {
    const id = randomUUID()
    const files = body.files.map((file, index) => ({ ...file, key: bugReportAttachmentKey(id, `${index}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80)}`)! }))
    const ticket = createBugReportUploadTicket({ id, userId: auth.userId, expiresAt: Date.now() + 10 * 60_000, files })
    const urls = await Promise.all(files.map((file) => generatePresignedUploadUrl(file.key, file.type || 'application/octet-stream', file.size, 600, undefined, true)))
    return NextResponse.json({ ticket, urls }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    logger.error('[bug-report] Could not prepare uploads', error)
    return NextResponse.json({ error: 'Could not prepare attachments. Please try again.' }, { status: 503 })
  }
}
