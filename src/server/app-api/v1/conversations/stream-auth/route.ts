import { logger } from '@/server/observability/logger'
import { NextRequest, NextResponse } from 'next/server'
import { getAuthorizedResourceUserId, type AppApiRouteContext } from '@/server/app-api/bff-context'
import { isVerifiedChatStreamRelayRequest } from '@/server/chat/chat-stream-relay-auth'
import { getOverlayServerContext } from '@/server/bootstrap'
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

    const conversation = await getOverlayServerContext().appData.repositories.conversations.getConversationById({
      conversationId: conversationId as Id<'conversations'>,
      userId: getAuthorizedResourceUserId(context),
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
