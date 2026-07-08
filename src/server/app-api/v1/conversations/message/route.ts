import { logger } from '@/server/observability/logger'
import { NextRequest, NextResponse } from 'next/server'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import { getInternalApiSecret } from '@/server/shared/internal-api-secret'
import { lazyConvex as convex } from '@/server/database/lazy-convex'
import {
  buildPersistedMessageContent,
  sanitizeMessagePartsForPersistence,
} from '@/server/chat/chat-message-persistence'
import { normalizeGeneratedUiData } from '@overlay/chat-core/generated-ui'
import type { Id } from '../../../../../../convex/_generated/dataModel'

export async function POST(request: NextRequest, context: AppApiRouteContext) {
  try {
    const body = await request.json() as {
      conversationId?: string
      turnId?: string
      mode?: 'ask' | 'act'
      role?: 'user' | 'assistant'
      content?: string
      parts?: Array<{ type: string; text?: string; url?: string; mediaType?: string }>
      attachmentNames?: string[]
      model?: string
      modelId?: string
      contentType?: 'text' | 'image' | 'video'
      variantIndex?: number
      replyToTurnId?: string
      replySnippet?: string
      accessToken?: string
      userId?: string
    }
    const { auth } = context


    const normalizedParts = sanitizeMessagePartsForPersistence(body.parts, {
      attachmentNames: body.attachmentNames,
    })
    const normalizedContent = buildPersistedMessageContent(body.content, body.parts, {
      attachmentNames: body.attachmentNames,
    })

    const turnId = body.turnId?.trim()
    if (!body.conversationId || !body.role || !normalizedContent || !turnId) {
      return NextResponse.json(
        { error: 'conversationId, turnId, role, and content or attachment are required' },
        { status: 400 },
      )
    }

    const mode = body.mode ?? 'act'
    const contentType = body.contentType ?? 'text'
    const modelId = body.modelId ?? body.model
    const serverSecret = getInternalApiSecret()

    await convex.mutation(
      'chat/conversations:addMessage',
      {
        conversationId: body.conversationId as Id<'conversations'>,
        userId: auth.userId,
        serverSecret,
        turnId,
        role: body.role,
        mode,
        content: normalizedContent,
        contentType,
        parts: normalizedParts,
        modelId,
        variantIndex: body.variantIndex,
        ...(body.replyToTurnId?.trim()
          ? { replyToTurnId: body.replyToTurnId.trim(), replySnippet: body.replySnippet?.trim() }
          : {}),
      },
      { throwOnError: true },
    )

    return NextResponse.json({ success: true, conversationId: body.conversationId, turnId })
  } catch (e) {
    logger.error('[conversations/message POST]', e)
    const msg = e instanceof Error ? e.message : 'Failed to save message'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest, context: AppApiRouteContext) {
  try {
    const body = await request.json() as {
      conversationId?: string
      turnId?: string
      accessToken?: string
      userId?: string
    }
    const { auth } = context
    const conversationId = body.conversationId?.trim()
    const turnId = body.turnId?.trim()
    if (!conversationId || !turnId) {
      return NextResponse.json({ error: 'conversationId and turnId are required' }, { status: 400 })
    }

    try {
      const serverSecret = getInternalApiSecret()
      await convex.mutation(
        'chat/conversations:deleteTurn',
        {
          conversationId: conversationId as Id<'conversations'>,
          userId: auth.userId,
          serverSecret,
          turnId,
        },
        { throwOnError: true },
      )
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (msg === 'Unauthorized' || msg.includes('Unauthorized')) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
      }
      if (msg.includes('Could not find public function')) {
        return NextResponse.json(
          {
            error:
              'Delete is unavailable until Convex is deployed with deleteTurn. Run `npx convex deploy` (or `npx convex dev`) for this project.',
          },
          { status: 503 },
        )
      }
      logger.error('[conversations/message DELETE]', err)
      return NextResponse.json({ error: msg || 'Failed to delete turn' }, { status: 500 })
    }

    return NextResponse.json({ success: true, conversationId, turnId })
  } catch (e) {
    logger.error('[conversations/message DELETE]', e)
    return NextResponse.json({ error: 'Failed to delete turn' }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest, context: AppApiRouteContext) {
  try {
    const body = await request.json() as {
      conversationId?: string
      messageId?: string
      partId?: string
      data?: unknown
      accessToken?: string
      userId?: string
    }
    const { auth } = context
    const conversationId = body.conversationId?.trim()
    const messageId = body.messageId?.trim()
    const partId = body.partId?.trim()
    const data = normalizeGeneratedUiData(body.data)
    if (!conversationId || !messageId || !partId || !data) {
      return NextResponse.json(
        { error: 'conversationId, messageId, partId, and valid generated UI data are required' },
        { status: 400 },
      )
    }

    try {
      const serverSecret = getInternalApiSecret()
      await convex.mutation(
        'chat/conversations:updateMessageUiPart',
        {
          conversationId: conversationId as Id<'conversations'>,
          messageId: messageId as Id<'conversationMessages'>,
          userId: auth.userId,
          serverSecret,
          partId,
          data,
        },
        { throwOnError: true },
      )
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (msg === 'Unauthorized' || msg.includes('Unauthorized')) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
      }
      if (msg.includes('Generated UI part not found') || msg.includes('Message not found')) {
        return NextResponse.json({ error: msg }, { status: 404 })
      }
      logger.error('[conversations/message PATCH]', err)
      return NextResponse.json({ error: msg || 'Failed to update generated UI part' }, { status: 500 })
    }

    return NextResponse.json({ success: true, conversationId, messageId, partId })
  } catch (e) {
    logger.error('[conversations/message PATCH]', e)
    return NextResponse.json({ error: 'Failed to update generated UI part' }, { status: 500 })
  }
}
