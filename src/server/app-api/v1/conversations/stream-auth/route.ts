import { logger } from '@/server/observability/logger'
import { NextRequest, NextResponse } from 'next/server'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import { getInternalApiSecret } from '@/server/shared/internal-api-secret'
import { isVerifiedChatStreamRelayRequest } from '@/server/chat/chat-stream-relay-auth'
import { lazyConvex as convex } from '@/server/database/lazy-convex'
import type { Id } from '../../../../../../convex/_generated/dataModel'

export async function POST(request: NextRequest, context: AppApiRouteContext) {
  try {
    if (!isVerifiedChatStreamRelayRequest(request)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json() as {
      conversationId?: string
      turnId?: string
      variantIndex?: number
      accessToken?: string
      userId?: string
    }

    const conversationId = body.conversationId?.trim()
    const turnId = body.turnId?.trim()
    if (!conversationId || !turnId) {
      return NextResponse.json(
        { error: 'conversationId and turnId are required' },
        { status: 400 },
      )
    }

    const { auth } = context

    const serverSecret = getInternalApiSecret()
    const conversation = await convex.query<{ _id: string } | null>('chat/conversations:get', {
      conversationId: conversationId as Id<'conversations'>,
      userId: auth.userId,
      serverSecret,
    })
    if (!conversation) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    return NextResponse.json({
      ok: true,
      userId: auth.userId,
      conversationId,
      turnId,
      variantIndex: Number.isFinite(body.variantIndex) ? body.variantIndex : 0,
    })
  } catch (error) {
    logger.error('[conversations/stream-auth]', error)
    return NextResponse.json({ error: 'Failed to authorize stream' }, { status: 500 })
  }
}
