import { randomUUID } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

const mocks = vi.hoisted(() => ({ auth: vi.fn(), limit: vi.fn(), send: vi.fn(), head: vi.fn(), presign: vi.fn(), idempotent: vi.fn(), fetch: vi.fn() }))
vi.mock('server-only', () => ({}))
vi.mock('@/server/auth/app-api-auth', () => ({ resolveAuthenticatedAppUser: mocks.auth }))
vi.mock('@/server/security/rate-limit', () => ({ enforceRateLimits: mocks.limit, getClientIp: () => 'test' }))
vi.mock('@/server/bootstrap', () => ({ getOverlayServerContext: () => ({ appData: { repositories: { idempotency: {} } } }) }))
vi.mock('@/server/app-api/idempotency', () => ({ handleIdempotentMutation: mocks.idempotent }))
vi.mock('@/server/config', () => ({ getOverlayRuntimeConfigSync: () => ({ providers: { email: { provider: 'resend' } }, email: { from: 'bugs@overlay.example' } }) }))
vi.mock('@/server/email/createEmailProvider', () => ({ createEmailProvider: async () => ({ send: mocks.send }) }))
vi.mock('@/server/observability/logger', () => ({ logger: { error: vi.fn() } }))
vi.mock('@/server/storage/object-store', () => ({ headObject: mocks.head, generatePresignedUploadUrl: mocks.presign }))
import { POST } from './route'
import { POST as prepareUpload } from './upload/route'
import { createBugReportUploadTicket } from '@/server/storage/bug-report-attachments'

function request(body: unknown, origin = 'https://overlay.example') {
  return new NextRequest('https://overlay.example/api/bug-report', {
    method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', 'Idempotency-Key': randomUUID() }, body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.stubEnv('OVERLAY_BUG_REPORT_GITHUB_TOKEN', 'test-only-token')
  vi.stubEnv('OVERLAY_BUG_REPORT_EMAIL_TO', 'owner@overlay.example')
  vi.stubEnv('OVERLAY_BUG_REPORT_ATTACHMENT_SECRET', 'test-only-attachment-signing-key-32-characters')
  vi.stubGlobal('fetch', mocks.fetch)
  mocks.auth.mockResolvedValue({ userId: 'user_1', authType: 'session', profile: { email: 'reporter@overlay.example' } })
  mocks.limit.mockResolvedValue(null)
  mocks.send.mockResolvedValue({ status: 'sent' })
  mocks.idempotent.mockImplementation((_request, _userId, run) => run())
  mocks.fetch.mockResolvedValue(Response.json({ html_url: 'https://github.com/LayerNorm/overlay-web/issues/123', number: 123 }, { status: 201 }))
  mocks.presign.mockResolvedValue('https://storage.example/upload')
})

describe('bug report route without real external side effects', () => {
  it('requires the same origin, a browser session and rate-limit acceptance before side effects', async () => {
    expect((await POST(request({}, 'https://evil.example'))).status).toBe(403)
    mocks.auth.mockResolvedValueOnce(null)
    expect((await POST(request({ description: 'A bug' }))).status).toBe(401)
    mocks.limit.mockResolvedValueOnce(NextResponse.json({ error: 'Too many requests' }, { status: 429 }))
    expect((await POST(request({ description: 'A bug' }))).status).toBe(429)
    expect(mocks.fetch).not.toHaveBeenCalled()
  })

  it('rejects invalid descriptions and missing configuration before calling GitHub', async () => {
    expect((await POST(request({ description: ' ' }))).status).toBe(400)
    expect((await POST(request({ description: 'a'.repeat(4001) }))).status).toBe(400)
    vi.stubEnv('OVERLAY_BUG_REPORT_GITHUB_TOKEN', '')
    expect((await POST(request({ description: 'A bug' }))).status).toBe(503)
    expect(mocks.fetch).not.toHaveBeenCalled()
  })

  it('creates the issue and sends the owner an email with the issue link and reporter, without exposing the reporter publicly', async () => {
    const response = await POST(request({ description: 'Broken <script>alert(1)</script>' }))
    expect(response.status).toBe(201)
    expect(await response.json()).toEqual({ url: 'https://github.com/LayerNorm/overlay-web/issues/123', emailSent: true })
    expect(mocks.idempotent).toHaveBeenCalledOnce()
    const issue = JSON.parse(mocks.fetch.mock.calls[0][1].body)
    expect(issue.body).toContain('&lt;script&gt;')
    expect(issue.body).not.toContain('reporter@overlay.example')
    expect(mocks.send.mock.calls[0][0]).toMatchObject({ to: 'owner@overlay.example', replyTo: 'reporter@overlay.example', idempotencyKey: 'bug-report-123' })
  })

  it('does not turn email failure into a duplicate-issue retry', async () => {
    mocks.send.mockRejectedValueOnce(new Error('Resend unavailable'))
    const response = await POST(request({ description: 'A bug' }))
    expect(response.status).toBe(201)
    expect((await response.json()).emailSent).toBe(false)
    expect(mocks.fetch).toHaveBeenCalledOnce()
  })

  it('does not send email when GitHub rejects the report', async () => {
    mocks.fetch.mockResolvedValueOnce(new Response('', { status: 403 }))
    expect((await POST(request({ description: 'A bug' }))).status).toBe(502)
    expect(mocks.send).not.toHaveBeenCalled()
  })

  it('prepares a full 5 MB direct upload and rejects totals above that cap', async () => {
    const file = { name: 'screenshot.png', type: 'image/png', size: 5 * 1024 * 1024 }
    const response = await prepareUpload(request({ files: [file] }))
    expect(response.status).toBe(200)
    expect((await response.json()).urls).toEqual(['https://storage.example/upload'])
    expect(mocks.presign.mock.calls[0].slice(1)).toEqual(['image/png', file.size, 600, undefined, true])
    expect((await prepareUpload(request({ files: [{ ...file, size: file.size + 1 }] }))).status).toBe(400)
    expect(mocks.fetch).not.toHaveBeenCalled()
  })

  it('validates uploaded bytes, expiry and ownership before creating an issue with a signed attachment link', async () => {
    const id = 'a6926951-600c-4482-bc08-3894c2c8f078'
    const file = { name: 'screen.png', type: 'image/png', size: 100, key: `bug-reports/${id}/0-screen.png` }
    const ticket = createBugReportUploadTicket({ id, userId: 'user_1', expiresAt: Date.now() + 60_000, files: [file] })
    mocks.head.mockResolvedValueOnce({ sizeBytes: 99, contentType: 'image/png' })
    expect((await POST(request({ description: 'A bug', ticket }))).status).toBe(400)
    mocks.head.mockResolvedValueOnce({ sizeBytes: 100, contentType: 'image/png' })
    expect((await POST(request({ description: 'A bug', ticket }))).status).toBe(201)
    expect(JSON.parse(mocks.fetch.mock.calls[0][1].body).body).toContain(`/api/bug-report/attachment/${id}/0-screen.png?sig=`)
    mocks.auth.mockResolvedValueOnce({ userId: 'another-user', authType: 'session' })
    expect((await POST(request({ description: 'A bug', ticket }))).status).toBe(400)
  })
})
