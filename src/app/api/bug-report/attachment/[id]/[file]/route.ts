import { NextRequest, NextResponse } from 'next/server'
import { bugReportAttachmentKey, verifyBugReportAttachment } from '@/server/storage/bug-report-attachments'
import { generatePresignedDownloadUrl, headObject } from '@/server/storage/object-store'

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string; file: string }> }) {
  const { id, file } = await params
  const key = bugReportAttachmentKey(id, file)
  if (!key || !verifyBugReportAttachment(key, request.nextUrl.searchParams.get('sig') ?? '')) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
  const stored = await headObject(key)
  if (!stored || stored.sizeBytes > 5 * 1024 * 1024) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const response = NextResponse.redirect(await generatePresignedDownloadUrl(key), 302)
  response.headers.set('Cache-Control', 'private, no-store')
  response.headers.set('Referrer-Policy', 'no-referrer')
  return response
}
