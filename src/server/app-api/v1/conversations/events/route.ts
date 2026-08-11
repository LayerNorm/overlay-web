import { NextRequest, NextResponse } from 'next/server'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import { getOverlayServerContext } from '@/server/bootstrap'

const LONG_POLL_MS = 15_000
const MAX_CONCURRENT_EVENT_POLLS_PER_USER = 10
const activeEventPollsByUser = new Map<string, number>()

export async function GET(request: NextRequest, context: AppApiRouteContext) {
  const repository = getOverlayServerContext().appData.repositories.conversationCollaboration
  const access = {
    actorUserId: context.auth.userId,
    workspaceId: context.workspace.workspace.id,
  }
  const rawAfter = request.nextUrl.searchParams.get('after')
  if (rawAfter === null) {
    const cursor = await repository.getConversationEventCursor(access)
    return NextResponse.json({ cursor, events: [] }, { headers: noStoreHeaders() })
  }

  const after = Number(rawAfter)
  if (!Number.isSafeInteger(after) || after < 0) {
    return NextResponse.json({ error: 'after must be a non-negative event cursor' }, { status: 400 })
  }

  // Per-user concurrent long-poll limit. Without this, a user could open
  // dozens of browser tabs and hold concurrent 15-second connections without
  // hitting the request-count rate limit.
  const userId = context.auth.userId
  const activeCount = activeEventPollsByUser.get(userId) ?? 0
  if (activeCount >= MAX_CONCURRENT_EVENT_POLLS_PER_USER) {
    return NextResponse.json(
      { error: 'too_many_concurrent_connections', message: 'Too many concurrent event connections.' },
      { status: 429, headers: { 'Retry-After': '5', ...noStoreHeaders() } },
    )
  }
  activeEventPollsByUser.set(userId, activeCount + 1)

  try {
    const deadline = Date.now() + LONG_POLL_MS
    let events = await repository.listConversationEvents({ ...access, afterSequence: after, limit: 100 })
    while (events.length === 0 && !request.signal.aborted && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 250))
      events = await repository.listConversationEvents({ ...access, afterSequence: after, limit: 100 })
    }

    return NextResponse.json({
      cursor: events.at(-1)?.sequence ?? after,
      events,
    }, { headers: noStoreHeaders() })
  } finally {
    const remaining = (activeEventPollsByUser.get(userId) ?? 1) - 1
    if (remaining <= 0) {
      activeEventPollsByUser.delete(userId)
    } else {
      activeEventPollsByUser.set(userId, remaining)
    }
  }
}

function noStoreHeaders(): HeadersInit {
  return {
    'Cache-Control': 'private, no-store, max-age=0',
    'X-Accel-Buffering': 'no',
  }
}
