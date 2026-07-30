import { logger } from '@/server/observability/logger'
import { NextRequest, NextResponse } from 'next/server'
import { getAuthorizedResourceUserId, type AppApiRouteContext } from '@/server/app-api/bff-context'
import { getOverlayServerContext } from '@/server/bootstrap'
import {
  buildPersistedMessageContent,
  sanitizeMessagePartsForPersistence,
} from '@/server/chat/chat-message-persistence'
import { normalizeGeneratedUiData } from '@overlay/chat-core/generated-ui'
import type { Id } from '../../../../../../convex/_generated/dataModel'
import { invokeWorkspaceAgentsForHumanMessage } from '@/server/agents/workspace-agent-invocation'

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
      clientNonce?: string
      threadRootMessageId?: string
      mentionedPrincipalIds?: string[]
    }


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
    const server = getOverlayServerContext()
    const messageId = await server.appData.repositories.conversations.addMessage({
      conversationId: body.conversationId as Id<'conversations'>,
      userId: context.auth.userId,
      workspaceId: context.workspace.workspace.id,
      authorKind: body.role === 'user' ? 'human' : 'model',
      authorPrincipalId: body.role === 'user' ? context.workspace.principal.id : undefined,
      clientNonce: body.clientNonce?.trim() || undefined,
      threadRootMessageId: body.threadRootMessageId?.trim(),
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
    })
    if (messageId && body.role === 'user') {
      await server.appData.repositories.conversationCollaboration.recordMessageActivity({
        actorUserId: context.auth.userId,
        workspaceId: context.workspace.workspace.id,
        conversationId: body.conversationId,
        messageId,
        body: normalizedContent,
        mentionedPrincipalIds: body.mentionedPrincipalIds,
      })
      await invokeWorkspaceAgentsForHumanMessage({
        accessToken: context.auth.accessToken,
        actorUserId: context.auth.userId,
        workspaceId: context.workspace.workspace.id,
        conversationId: body.conversationId,
        messageId,
        mentionedPrincipalIds: body.mentionedPrincipalIds,
        threadRootMessageId: body.threadRootMessageId?.trim(),
      })
    }

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
    const conversationId = body.conversationId?.trim()
    const turnId = body.turnId?.trim()
    if (!conversationId || !turnId) {
      return NextResponse.json({ error: 'conversationId and turnId are required' }, { status: 400 })
    }

    try {
      await getOverlayServerContext().appData.repositories.conversations.deleteTurn({
        conversationId: conversationId as Id<'conversations'>,
        userId: getAuthorizedResourceUserId(context),
        turnId,
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (msg === 'Unauthorized' || msg.includes('Unauthorized')) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
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
      const updated = await getOverlayServerContext().appData.repositories.conversations.updateMessageUiPart({
        conversationId: conversationId as Id<'conversations'>,
        messageId: messageId as Id<'conversationMessages'>,
        userId: getAuthorizedResourceUserId(context),
        partId,
        data: data as unknown as Record<string, unknown>,
      })
      if (!updated) {
        return NextResponse.json({ error: 'Generated UI part not found' }, { status: 404 })
      }
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
