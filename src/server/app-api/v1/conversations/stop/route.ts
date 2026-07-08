import { logger } from '@/server/observability/logger'
import { NextRequest, NextResponse } from 'next/server'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import { getInternalApiSecret } from '@/server/shared/internal-api-secret'
import { lazyConvex as convex } from '@/server/database/lazy-convex'
import type { Id } from '../../../../../../convex/_generated/dataModel'

export async function POST(request: NextRequest, context: AppApiRouteContext) {
  try {
    const body = await request.json() as {
      conversationId?: string
      messageId?: string
      accessToken?: string
      userId?: string
    }

    const { auth } = context

    const conversationId = body.conversationId?.trim()
    if (!conversationId) {
      return NextResponse.json(
        { error: 'conversationId is required' },
        { status: 400 },
      )
    }

    const serverSecret = getInternalApiSecret()
    const result = await convex.mutation('chat/conversations:stopGeneratingMessage', {
      conversationId: conversationId as Id<'conversations'>,
      ...(body.messageId ? { messageId: body.messageId as Id<'conversationMessages'> } : {}),
      userId: auth.userId,
      serverSecret,
    }) as { stoppedCount: number }

    return NextResponse.json({ success: true, stoppedCount: result.stoppedCount })
  } catch (e) {
    logger.error('[conversations/stop POST]', e)
    const msg = e instanceof Error ? e.message : 'Failed to stop generating message'
    if (msg === 'Unauthorized') {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
