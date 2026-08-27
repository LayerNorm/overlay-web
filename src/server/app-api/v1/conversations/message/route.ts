import { logger } from '@/server/observability/logger'
import { NextRequest, NextResponse } from 'next/server'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import { getOverlayServerContext } from '@/server/bootstrap'
import {
  buildPersistedMessageContent,
  sanitizeMessagePartsForPersistence,
} from '@/server/chat/chat-message-persistence'
import { normalizeGeneratedUiData } from '@overlay/chat-core/generated-ui'
import { start } from 'workflow/api'
import {
  resolveWorkspaceAgentInvocations,
  startRemoteWorkspaceAgentTurn,
} from '@/server/agents/workspace-agent-invocation'
import { workspaceAgentTurnWorkflow } from '@/workflows/workspace-agent-turn'
import type { Id } from '../../../../../../convex/_generated/dataModel'

/**
 * Opens a durable run per agent that owes a reply, and starts the workflow that
 * writes it.
 *
 * This is the only thing that invokes a room agent. Triggering server-side is
 * what makes a turn asynchronous: the sender's request returns as soon as the
 * runs exist, and the turns continue whether or not anyone is still watching.
 * Failures here are logged rather than raised — the human message is already
 * saved, and failing the send because an agent could not be started would be
 * the worse outcome.
 */
async function triggerWorkspaceAgentTurns(args: {
  actorUserId: string
  conversationId: string
  messageId: string
  mentionedPrincipalIds: string[]
  initiatorPrincipalId: string
  prompt: string
  threadRootMessageId?: string
  workspaceId: string
}): Promise<void> {
  const collaboration = getOverlayServerContext().appData.repositories.conversationCollaboration
  const invocations = await resolveWorkspaceAgentInvocations(args)
  for (const invocation of invocations) {
    try {
      if (invocation.remoteTarget) {
        await startRemoteWorkspaceAgentTurn({
          actorUserId: args.actorUserId,
          conversationId: args.conversationId,
          initiatorPrincipalId: args.initiatorPrincipalId,
          invocation: { ...invocation, remoteTarget: invocation.remoteTarget },
          messageId: args.messageId,
          prompt: args.prompt,
          ...(args.threadRootMessageId ? { threadRootMessageId: args.threadRootMessageId } : {}),
          workspaceId: args.workspaceId,
        })
        continue
      }
      const turn = await collaboration.startAgentTurn({
        actorUserId: args.actorUserId,
        agentId: invocation.agentId,
        authorPrincipalId: invocation.agentPrincipalId,
        clientNonce: invocation.invocationNonce,
        conversationId: args.conversationId,
        modelId: invocation.modelId,
        threadRootMessageId: args.threadRootMessageId,
        turnId: invocation.turnId,
        userMessageId: args.messageId,
        workspaceId: args.workspaceId,
      })
      // A turn already exists for this (message, agent): a duplicate trigger,
      // or a retried send. Starting a second workflow against the same reply
      // row would bill the turn twice.
      if (turn.resumed) continue
      await start(workspaceAgentTurnWorkflow, [{
        actorUserId: args.actorUserId,
        agentId: invocation.agentId,
        conversationId: args.conversationId,
        messageId: args.messageId,
        runId: turn.runId,
        ...(args.threadRootMessageId ? { threadRootMessageId: args.threadRootMessageId } : {}),
        turnMessageId: turn.messageId,
        workspaceId: args.workspaceId,
      }])
    } catch (error) {
      logger.error('[conversations/message POST] Failed to start an agent turn', {
        agentId: invocation.agentId,
        conversationId: args.conversationId,
        error,
        messageId: args.messageId,
      })
    }
  }
}

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
      mentionedPrincipalIds?: string[]
      threadRootMessageId?: string
      clientNonce?: string
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
    const server = getOverlayServerContext()
    const workspaceId = context.workspace.workspace.id
    await server.workspaceGovernanceService.assertWithinLimits({
      action: 'message.send',
      scope: { workspaceId, principalId: context.workspace.principal.id, conversationId: body.conversationId },
    })
    const conversation = await server.appData.repositories.conversations.getConversationById({
      conversationId: body.conversationId as Id<'conversations'>,
      userId: auth.userId,
      workspaceId,
    }) ?? await server.appData.repositories.conversationCollaboration.getAccessibleConversation({
      actorUserId: auth.userId,
      conversationId: body.conversationId,
      workspaceId,
    })
    if (!conversation) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })
    }
    const isCollaborationConversation = (conversation.conversationType ?? 'personal') !== 'personal'
    const messageId = isCollaborationConversation
      ? await server.appData.repositories.conversationCollaboration.addMessage({
          actorUserId: auth.userId,
          conversationId: body.conversationId,
          workspaceId,
          turnId,
          content: normalizedContent,
          parts: normalizedParts,
          clientNonce: body.clientNonce?.trim() || undefined,
          threadRootMessageId: body.threadRootMessageId?.trim() || undefined,
          ...(body.replyToTurnId?.trim()
            ? { replyToTurnId: body.replyToTurnId.trim(), replySnippet: body.replySnippet?.trim() }
            : {}),
        })
      : await server.appData.repositories.conversations.addMessage({
          conversationId: body.conversationId as Id<'conversations'>,
          userId: auth.userId,
          workspaceId,
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

    // Record message activity and publish workspace.mention lifecycle events for
    // human @-mentions in workspace conversations (DMs and channels).
    const mentionedPrincipalIds = Array.isArray(body.mentionedPrincipalIds)
      ? body.mentionedPrincipalIds.filter((value): value is string => typeof value === 'string')
      : []
    if (isCollaborationConversation && messageId) {
      const workspaceName = context.workspace.workspace.name
      const actorPrincipalId = context.workspace.principal.id
      const actorDisplayName = context.workspace.principal.displayName
      const conversationId = body.conversationId

      try {
        await server.appData.repositories.conversationCollaboration.recordMessageActivity({
          actorUserId: auth.userId,
          workspaceId,
          conversationId,
          messageId: String(messageId),
          body: normalizedContent,
          mentionedPrincipalIds,
          ...(body.threadRootMessageId?.trim() ? { threadRootMessageId: body.threadRootMessageId.trim() } : {}),
        })
      } catch (error) {
        logger.warn('[conversations/message POST] recordMessageActivity failed', { error })
      }

      const conversationTitle = conversation.title || 'a conversation'

      for (const mentionedPrincipalId of mentionedPrincipalIds) {
        try {
          const principal = await server.workspaceService.resolvePrincipal(mentionedPrincipalId)
          if (!principal?.userId || principal.type !== 'human') continue
          await server.lifecycleEvents.publish({
            attributes: {
              workspaceId,
              workspaceName,
              conversationId,
              conversationTitle,
              mentionedByPrincipalId: actorPrincipalId,
              mentionedByDisplayName: actorDisplayName,
            },
            idempotencyKey: `workspace.mention:${messageId}:${mentionedPrincipalId}`,
            name: 'workspace.mention',
            resource: { id: String(messageId), type: 'workspace_mention' },
            userId: principal.userId,
          })
        } catch (error) {
          logger.warn('[conversations/message POST] Failed to publish mention lifecycle event', { error })
        }
      }
    }

    if (isCollaborationConversation && messageId) {
      await triggerWorkspaceAgentTurns({
        actorUserId: auth.userId,
        conversationId: body.conversationId,
        initiatorPrincipalId: context.workspace.principal.id,
        mentionedPrincipalIds,
        messageId: String(messageId),
        prompt: normalizedContent,
        ...(body.threadRootMessageId?.trim() ? { threadRootMessageId: body.threadRootMessageId.trim() } : {}),
        workspaceId,
      }).catch((error) => {
        // `resolveWorkspaceAgentInvocations` throws when no agent was addressed,
        // which is the common case for a message between people.
        logger.debug('[conversations/message POST] No agent turn started', { error })
      })
    }

    return NextResponse.json({ success: true, conversationId: body.conversationId, turnId, messageId })
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
      await getOverlayServerContext().appData.repositories.conversations.deleteTurn({
        conversationId: conversationId as Id<'conversations'>,
        userId: auth.userId,
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
      const updated = await getOverlayServerContext().appData.repositories.conversations.updateMessageUiPart({
        conversationId: conversationId as Id<'conversations'>,
        messageId: messageId as Id<'conversationMessages'>,
        userId: auth.userId,
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
