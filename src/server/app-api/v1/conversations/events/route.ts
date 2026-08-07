import { NextRequest, NextResponse } from 'next/server'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import { getOverlayServerContext } from '@/server/bootstrap'

const LONG_POLL_MS = 15_000

export async function GET(request: NextRequest, context: AppApiRouteContext) {
  const repository = getOverlayServerContext().appData.repositories.conversations
  const rawAfter = request.nextUrl.searchParams.get('after')
  if (rawAfter === null) {
    const cursor = await repository.getConversationEventCursor({ userId: context.auth.userId })
    return NextResponse.json({ cursor, events: [] }, { headers: noStoreHeaders() })
  }

  const after = Number(rawAfter)
  if (!Number.isSafeInteger(after) || after < 0) {
    return NextResponse.json({ error: 'after must be a non-negative event cursor' }, { status: 400 })
  }

  const events = await repository.waitForConversationEvents({
    afterSequence: after,
    limit: 100,
    signal: request.signal,
    timeoutMs: LONG_POLL_MS,
    userId: context.auth.userId,
  })

  return NextResponse.json({
    cursor: events.at(-1)?.sequence ?? after,
    events,
  }, { headers: noStoreHeaders() })
}

function noStoreHeaders(): HeadersInit {
  return {
    'Cache-Control': 'private, no-store, max-age=0',
    'X-Accel-Buffering': 'no',
  }
}
