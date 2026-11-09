import 'server-only'

import { createHmac, timingSafeEqual } from 'node:crypto'
import { validBugReportFiles, type BugReportFile } from '@/shared/storage/bug-report'
import { readBoundedStorageBody } from './read-bounded-storage-body'

const FILE_PATH = /^[a-f0-9-]{36}\/\d{1,2}-[a-zA-Z0-9._-]{1,90}$/

export function bugReportAttachmentKey(id: string, file: string): string | null {
  const path = `${id}/${file}`
  return FILE_PATH.test(path) ? `bug-reports/${path}` : null
}

export function signBugReportAttachment(key: string): string {
  const secret = process.env.OVERLAY_BUG_REPORT_ATTACHMENT_SECRET
  if (!secret || secret.length < 32) throw new Error('Bug report attachment signing secret is not configured')
  return createHmac('sha256', secret).update(key).digest('hex')
}

export function verifyBugReportAttachment(key: string, signature: string): boolean {
  if (!/^[a-f0-9]{64}$/.test(signature)) return false
  if ((process.env.OVERLAY_BUG_REPORT_ATTACHMENT_SECRET?.length ?? 0) < 32) return false
  const expected = Buffer.from(signBugReportAttachment(key), 'hex')
  return timingSafeEqual(expected, Buffer.from(signature, 'hex'))
}

export type BugReportUpload = { id: string; userId: string; expiresAt: number; files: (BugReportFile & { key: string })[] }

export function createBugReportUploadTicket(upload: BugReportUpload): string {
  const payload = Buffer.from(JSON.stringify(upload)).toString('base64url')
  return `${payload}.${signBugReportAttachment(payload)}`
}

export function verifyBugReportUploadTicket(ticket: string, userId: string): BugReportUpload | null {
  try {
    if (ticket.length > 16_000) return null
    const [payload, signature] = ticket.split('.')
    if (!payload || !signature || !verifyBugReportAttachment(payload, signature)) return null
    const upload = JSON.parse(Buffer.from(payload, 'base64url').toString()) as BugReportUpload
    if (upload.userId !== userId || upload.expiresAt < Date.now() || !validBugReportFiles(upload.files)) return null
    return upload
  } catch (_error) { return null }
}

export async function readBugReportJson(request: Request): Promise<Record<string, unknown> | null> {
  try {
    if (!request.body || !request.headers.get('content-type')?.startsWith('application/json')) return null
    const bytes = await readBoundedStorageBody(request.body, 24_000)
    const value: unknown = JSON.parse(new TextDecoder().decode(bytes))
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
  } catch (_error) { return null }
}
