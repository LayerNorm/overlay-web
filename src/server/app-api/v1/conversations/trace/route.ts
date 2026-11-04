import { NextRequest, NextResponse } from 'next/server'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import { lazyConvex } from '@/server/database/lazy-convex'
import { getInternalApiSecret } from '@/server/shared/internal-api-secret'
import { createPublicTranscriptStream, type PublicTranscriptPage } from '@/server/harness/public-transcript'

export async function GET(request: NextRequest, context: AppApiRouteContext) {
  const messageId = request.nextUrl.searchParams.get('messageId')?.trim()
  if (!messageId || messageId.length > 256) return NextResponse.json({ error: 'A message is required.' }, { status: 400 })
  const loadPage = (afterSequence?: number) => lazyConvex.query<PublicTranscriptPage | null>(
    'harness/runs:listMessageTranscriptSteps', {
      actorUserId: context.auth.userId, workspaceId: context.workspace.workspace.id, messageId,
      ...(afterSequence !== undefined ? { afterSequence } : {}), serverSecret: getInternalApiSecret(),
    }, { throwOnError: true },
  )
  try {
    const firstPage = await loadPage()
    if (!firstPage) return NextResponse.json({ error: 'Trace not found.' }, { status: 404 })
    return new NextResponse(createPublicTranscriptStream({ firstPage, loadPage, signal: request.signal }), {
      headers: { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' },
    })
  } catch (error) {
    const denied = error instanceof Error && /(?:CONVERSATION|WORKSPACE)_ACCESS_DENIED/.test(error.message)
    return NextResponse.json({ error: denied ? 'Trace not found.' : 'Could not load the trace.' }, { status: denied ? 404 : 503 })
  }
}
