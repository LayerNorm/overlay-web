import assert from 'node:assert/strict'
import test from 'node:test'
import { bugReportAttachmentKey, createBugReportUploadTicket, readBugReportJson, signBugReportAttachment, verifyBugReportAttachment, verifyBugReportUploadTicket } from './bug-report-attachments'
import { BUG_REPORT_MAX_BYTES, validBugReportFiles } from '@/shared/storage/bug-report'

test('attachment policy accepts exactly 5 MB and rejects oversized, excessive and unsafe files', () => {
  const file = { name: 'screen.png', type: 'image/png', size: BUG_REPORT_MAX_BYTES }
  assert.equal(validBugReportFiles([file]), true)
  assert.equal(validBugReportFiles([{ ...file, size: BUG_REPORT_MAX_BYTES + 1 }]), false)
  assert.equal(validBugReportFiles([file, { ...file, size: 1 }]), false)
  assert.equal(validBugReportFiles(Array(11).fill({ ...file, size: 1 })), false)
  for (const name of ['page.html', 'logo.svg', 'app.exe', 'screen.png.exe']) assert.equal(validBugReportFiles([{ ...file, name }]), false)
  for (const value of [null, {}, ['oops'], [{ name: 'a.txt', size: -1, type: '' }]]) assert.equal(validBugReportFiles(value), false)
})

test('upload tickets are private to their user, expire, and reject tampering', () => {
  const previous = process.env.OVERLAY_BUG_REPORT_ATTACHMENT_SECRET
  process.env.OVERLAY_BUG_REPORT_ATTACHMENT_SECRET = 'test-only-attachment-signing-key-32-characters'
  try {
    const id = 'a6926951-600c-4482-bc08-3894c2c8f078'
    const key = bugReportAttachmentKey(id, '0-screen.png')!
    const upload = { id, userId: 'user_1', expiresAt: Date.now() + 60_000, files: [{ key, name: 'screen.png', type: 'image/png', size: 10 }] }
    const ticket = createBugReportUploadTicket(upload)
    assert.deepEqual(verifyBugReportUploadTicket(ticket, 'user_1'), upload)
    assert.equal(verifyBugReportUploadTicket(ticket, 'user_2'), null)
    assert.equal(verifyBugReportUploadTicket(`x${ticket}`, 'user_1'), null)
    assert.equal(verifyBugReportUploadTicket(createBugReportUploadTicket({ ...upload, expiresAt: Date.now() - 1 }), 'user_1'), null)
    const signature = signBugReportAttachment(key)
    assert.equal(verifyBugReportAttachment(key, signature), true)
    assert.equal(verifyBugReportAttachment(`${key}x`, signature), false)
    assert.equal(verifyBugReportAttachment(key, 'invalid'), false)
    assert.equal(bugReportAttachmentKey(id, '../private.txt'), null)
  } finally {
    if (previous === undefined) delete process.env.OVERLAY_BUG_REPORT_ATTACHMENT_SECRET
    else process.env.OVERLAY_BUG_REPORT_ATTACHMENT_SECRET = previous
  }
})

test('report bodies are bounded before JSON parsing, including chunked uploads', async () => {
  const request = (body: string) => new Request('https://overlay.example/api/bug-report', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })
  assert.deepEqual(await readBugReportJson(request('{"description":"A bug"}')), { description: 'A bug' })
  assert.equal(await readBugReportJson(request('x'.repeat(24_001))), null)
  assert.equal(await readBugReportJson(request('not json')), null)
  assert.equal(await readBugReportJson(request('[]')), null)
})
