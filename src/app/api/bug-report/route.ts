import { NextRequest, NextResponse } from 'next/server'
import { unstable_rethrow } from 'next/navigation'
import { getOverlayRuntimeConfigSync } from '@/server/config'
import { createEmailProvider } from '@/server/email/createEmailProvider'
import { logger } from '@/server/observability/logger'
import { enforceRateLimits, getClientIp } from '@/server/security/rate-limit'
import { readBugReportJson, signBugReportAttachment, verifyBugReportUploadTicket } from '@/server/storage/bug-report-attachments'
import { headObject } from '@/server/storage/object-store'
import { getOverlayServerContext } from '@/server/bootstrap'
import { handleIdempotentMutation } from '@/server/app-api/idempotency'

function errorResponse(error: string, status: number) {
  return NextResponse.json({ error }, { status, headers: { 'Cache-Control': 'no-store' } })
}

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
}

export async function POST(request: NextRequest) {
  if (request.headers.get('origin') !== request.nextUrl.origin || request.headers.get('sec-fetch-site') === 'cross-site') {
    return errorResponse('Invalid request origin.', 403)
  }
  const context = getOverlayServerContext()
  const session = await context.auth.getSession(request)
  if (!session) return errorResponse('Sign in to report a bug.', 401)
  const userId = session.user.id
  const reporterEmail = session.user.email
  const limited = await enforceRateLimits(request, [
    { bucket: 'bug-report:ip', key: getClientIp(request), limit: 10, windowMs: 60 * 60_000 },
    { bucket: 'bug-report:user', key: userId, limit: 3, windowMs: 60 * 60_000 },
  ])
  if (limited) return limited
  if (!/^[a-f0-9-]{36}$/i.test(request.headers.get('idempotency-key') ?? '')) return errorResponse('Invalid report request.', 400)

  const githubToken = process.env.OVERLAY_BUG_REPORT_GITHUB_TOKEN
  const recipient = process.env.OVERLAY_BUG_REPORT_EMAIL_TO
  const config = getOverlayRuntimeConfigSync()
  if (!githubToken || !recipient || !config.email?.from || (config.providers.email?.provider ?? config.email?.provider) !== 'resend') {
    return errorResponse('Bug reporting is not configured. Please try again later.', 503)
  }
  const body = await readBugReportJson(request)
  if (!body) return errorResponse('Invalid bug report.', 400)
  const idempotentRequest = new NextRequest(request.url, { method: 'POST', headers: request.headers, body: JSON.stringify(body) })
  return handleIdempotentMutation(idempotentRequest, userId, async () => {
  try {
    const description = body.description
    if (typeof description !== 'string' || !description.trim() || description.trim().length > 4000) return errorResponse('Describe the bug in 4,000 characters or fewer.', 400)
    const upload = typeof body.ticket === 'string' ? verifyBugReportUploadTicket(body.ticket, userId) : null
    if (body.ticket && !upload) return errorResponse('Attachments expired. Please choose your files again.', 400)
    const files = upload?.files ?? []
    const id = upload?.id
      const links: string[] = []
      for (const file of files) {
        const stored = await headObject(file.key)
        if (!stored || stored.sizeBytes !== file.size || stored.contentType !== (file.type || 'application/octet-stream')) return errorResponse('Attachment upload is incomplete. Please try again.', 400)
        const storedName = file.key.split('/').at(-1)!
        const url = new URL(`/api/bug-report/attachment/${id}/${storedName}`, request.nextUrl.origin)
        url.searchParams.set('sig', signBugReportAttachment(file.key))
        links.push(`- [${storedName.slice(storedName.indexOf('-') + 1)}](${url.href})`)
      }
      const title = `Bug report: ${description.trim().split('\n')[0].slice(0, 80)}`
      const issueBody = `Reported from Overlay.\n\n<pre>${escapeHtml(description.trim())}</pre>${links.length ? `\n\nAttachments (public download links):\n${links.join('\n')}` : ''}`
      const response = await fetch('https://api.github.com/repos/LayerNorm/overlay-web/issues', {
        method: 'POST',
        headers: { Authorization: `Bearer ${githubToken}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, body: issueBody }),
        signal: AbortSignal.timeout(15_000),
      })
      if (!response.ok) throw new Error(`GitHub rejected bug report (${response.status})`)
      const issue = await response.json() as { html_url?: string; number?: number }
      if (!issue.html_url?.startsWith('https://github.com/LayerNorm/overlay-web/issues/') || !issue.number) throw new Error('GitHub returned an invalid issue')

      let emailSent = false
      try {
        const provider = await createEmailProvider(config)
        const result = await provider.send({
          from: config.email!.from!, to: recipient, replyTo: reporterEmail,
          subject: `Overlay bug report #${issue.number}`,
          text: `Issue: ${issue.html_url}\nReporter: ${reporterEmail}\n\n${description.trim()}`,
          html: `<p><a href="${issue.html_url}">View bug report #${issue.number}</a></p><p>Reporter: ${escapeHtml(reporterEmail)}</p><pre>${escapeHtml(description.trim())}</pre>`,
          idempotencyKey: `bug-report-${issue.number}`,
        })
        emailSent = result.status === 'sent'
      } catch (error) {
        logger.error('[bug-report] GitHub issue created but email notification failed', error)
      }
      return NextResponse.json({ url: issue.html_url, emailSent }, { status: 201 })
  } catch (error) {
    unstable_rethrow(error)
    logger.error('[bug-report] Submission failed', error)
    return errorResponse('Could not submit the bug report. Please try again.', 502)
  }
  }, { repository: context.appData.repositories.idempotency })
}
