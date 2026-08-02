import { logger } from '@/server/observability/logger'
import { NextRequest, NextResponse } from 'next/server'
import { getAuthorizedResourceUserId, getGrantedResources, type AppApiRouteContext } from '@/server/app-api/bff-context'
import { getOverlayServerContext } from '@/server/bootstrap'
import {
  DEFAULT_MODEL_ID,
  FREE_TIER_DEFAULT_MODEL_ID,
  resolveFreeTierChatModelId,
} from '@/shared/ai/gateway/model-types'
import { normalizeChatModelSelection } from '@/shared/chat/chat-model-prefs'
import { canUsePaidBudgetFeatures } from '@/server/billing/billing-runtime'
import {
  GENERATED_UI_DATA_TYPE,
  normalizeGeneratedUiData,
} from '@overlay/chat-core/generated-ui'
import type {
  ConversationMessageRow,
} from '@/server/conversations/ActConversationRepository'
import type { Id } from '../../../../../convex/_generated/dataModel'
import { KnowledgeBaseServiceError } from '@/server/knowledge-bases'

function clampFreeTierAskModels(modelIds: string[] | undefined): string[] {
  const requested =
    modelIds
      ?.map(resolveFreeTierChatModelId)
      .filter((id): id is string => Boolean(id)) ?? []
  const deduped = [...new Set(requested)].slice(0, 4)
  return deduped.length > 0 ? deduped : [FREE_TIER_DEFAULT_MODEL_ID]
}

function normalizePaidChatModels(modelIds: string[] | undefined, actModelId: string | undefined) {
  return normalizeChatModelSelection({
    askModelIds: modelIds,
    actModelId,
    fallbackModelId: DEFAULT_MODEL_ID,
  })
}

function readBooleanParam(value: string | null): boolean | undefined {
  if (value == null) return undefined
  if (value === 'true' || value === '1') return true
  if (value === 'false' || value === '0') return false
  return undefined
}

function readPositiveIntParam(value: string | null, max: number): number | undefined {
  if (!value) return undefined
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return undefined
  const int = Math.floor(parsed)
  if (int <= 0) return undefined
  return Math.min(max, int)
}

function conversationTypeForView(value: string | null): 'personal' | 'dm' | 'channel' | undefined {
  if (value === 'personal') return 'personal'
  if (value === 'dms') return 'dm'
  if (value === 'channels') return 'channel'
  return undefined
}

export async function GET(request: NextRequest, context: AppApiRouteContext) {
  try {
    const { auth } = context
    const { appData } = getOverlayServerContext()
    const repository = appData.repositories.conversations

    const { searchParams } = request.nextUrl
    const conversationId = searchParams.get('conversationId')
    const resourceUserId = getAuthorizedResourceUserId(context)
    const includeMessages = searchParams.get('messages') === 'true'
    const projectId = searchParams.get('projectId')
    const updatedSinceParam = searchParams.get('updatedSince')
    const updatedSince = updatedSinceParam ? Number(updatedSinceParam) : undefined
    const includeDeleted = readBooleanParam(searchParams.get('includeDeleted'))
    const messageLimit = readPositiveIntParam(searchParams.get('limit'), 100)
    const beforeCreatedAtParam = searchParams.get('beforeCreatedAt')
    const beforeCreatedAt = beforeCreatedAtParam ? Number(beforeCreatedAtParam) : undefined
    const mainOnly = readBooleanParam(searchParams.get('mainOnly'))
    const threadRootMessageId = searchParams.get('threadRootMessageId')?.trim() || undefined
    const targetMessageId = searchParams.get('messageId')?.trim() || undefined
    const compactToolPayloads = readBooleanParam(searchParams.get('compactToolPayloads')) === true
    const workspaceId = context.workspace.workspace.id
    const conversationType = conversationTypeForView(searchParams.get('view'))
    const collaboration = appData.repositories.conversationCollaboration

    if (conversationId && !includeMessages) {
      const conv = await repository.getConversationById({
        conversationId: conversationId as Id<'conversations'>,
        userId: resourceUserId,
        workspaceId,
      })
      if (!conv) return NextResponse.json({ error: 'Not found' }, { status: 404 })
      return NextResponse.json({
        ...conv,
        knowledgeBaseId: (await getOverlayServerContext().knowledgeBaseService
          .getConversationKnowledgeBase({ conversationId, userId: resourceUserId }))?.id,
      })
    }

    if (conversationId && includeMessages) {
      const conv = await repository.getConversationById({
        conversationId: conversationId as Id<'conversations'>,
        userId: resourceUserId,
        workspaceId,
      })
      if (!conv) return NextResponse.json({ error: 'Not found' }, { status: 404 })

      let messages: ConversationMessageRow[]
      if (targetMessageId) {
        const allMessages = await repository.getConversationMessages({
          conversationId: conversationId as Id<'conversations'>,
          userId: resourceUserId,
          workspaceId,
        })
        const targetIndex = allMessages.findIndex((message) => message._id === targetMessageId)
        if (targetIndex < 0) {
          messages = []
        } else {
          const start = Math.max(0, targetIndex - Math.max(1, Math.floor((messageLimit ?? 100) / 2)))
          const end = Math.min(allMessages.length, start + (messageLimit ?? 100))
          messages = allMessages.slice(start, end)
        }
      } else if (messageLimit) {
        try {
          messages = await repository.getRecentMessages({
            conversationId: conversationId as Id<'conversations'>,
            userId: resourceUserId,
            workspaceId,
            limit: messageLimit,
            ...(Number.isFinite(beforeCreatedAt) ? { beforeCreatedAt } : {}),
            ...(mainOnly !== undefined ? { mainOnly } : {}),
            ...(threadRootMessageId ? { threadRootMessageId } : {}),
            compactToolPayloads,
          })
        } catch (error) {
          logger.warn('[conversations GET] Falling back to full message load after recent load failed', {
            conversationId,
            error: error instanceof Error ? error.message : String(error),
          })
          messages = await repository.getConversationMessages({
            conversationId: conversationId as Id<'conversations'>,
            userId: resourceUserId,
            workspaceId,
          })
        }
      } else {
        messages = await repository.getConversationMessages({
          conversationId: conversationId as Id<'conversations'>,
          userId: resourceUserId,
          workspaceId,
        })
      }

      const earliestCreatedAt = messages.length
        ? Math.min(...messages.map((message) => message.createdAt))
        : undefined

      return NextResponse.json({
        ...(messageLimit ? {
          limit: messageLimit,
          hasMore: messages.length >= messageLimit || Boolean(targetMessageId && messages.length > 0 && messages[0]?._id !== targetMessageId),
          earliestCreatedAt,
        } : {}),
        messages: messages.map(serializeConversationMessage),
      })
    }

    if (projectId) {
      const list = await repository.listConversationsByProject({
        projectId,
        userId: auth.userId,
        workspaceId,
        ...(Number.isFinite(updatedSince) ? { updatedSince } : {}),
        ...(includeDeleted !== undefined ? { includeDeleted } : {}),
      })
      const granted = await loadGrantedConversations(context, repository, workspaceId)
      const accessibleIds = new Set(await collaboration.listAccessibleConversationIds({
        actorUserId: auth.userId,
        workspaceId,
      }))
      return NextResponse.json([...list, ...granted].filter((conversation) => (
        accessibleIds.has(conversation._id) &&
        conversation.projectId === projectId &&
        (!Number.isFinite(updatedSince) || (conversation.updatedAt ?? conversation.lastModified) >= updatedSince!) &&
        (includeDeleted === true || !conversation.deletedAt)
      )))
    }

    const list = await repository.listConversations({
      userId: auth.userId,
      workspaceId,
      conversationType,
      ...(Number.isFinite(updatedSince) ? { updatedSince } : {}),
      ...(includeDeleted !== undefined ? { includeDeleted } : {}),
    })
    const accessibleIds = new Set(await collaboration.listAccessibleConversationIds({
      actorUserId: auth.userId,
      workspaceId,
    }))

    return NextResponse.json([
      ...list,
      ...await loadGrantedConversations(context, repository, workspaceId),
    ].filter((conversation) => accessibleIds.has(conversation._id)))
  } catch (error) {
    logger.error('[conversations GET]', error)
    return NextResponse.json({ error: 'Failed to fetch conversations' }, { status: 500 })
  }
}

async function loadGrantedConversations(
  context: AppApiRouteContext,
  repository: ReturnType<typeof getOverlayServerContext>['appData']['repositories']['conversations'],
  workspaceId: string,
) {
  const values = await Promise.all(getGrantedResources(context).map(({ ownerUserId, resourceId }) => (
    repository.getConversationById({
      conversationId: resourceId as Id<'conversations'>,
      userId: ownerUserId,
      workspaceId,
    })
  )))
  return values.filter((value): value is NonNullable<typeof value> => Boolean(value))
}

export async function POST(request: NextRequest, context: AppApiRouteContext) {
  try {
    const body = await request.json() as {
      title?: string
      projectId?: string
      askModelIds?: string[]
      actModelId?: string
      lastMode?: 'ask' | 'act'
      clientId?: string
      knowledgeBaseId?: string
      accessToken?: string
      userId?: string
      conversationType?: 'personal' | 'dm' | 'channel'
    }
    const { auth } = context
    const resourceUserId = getAuthorizedResourceUserId(context)
    const { appData, chatUsagePolicy } = getOverlayServerContext()
    const repository = appData.repositories.conversations
    const entitlements = await chatUsagePolicy.getEntitlements({ userId: auth.userId })
    const isFreeTier = !entitlements || !canUsePaidBudgetFeatures(entitlements)
    const freeAskModelIds = clampFreeTierAskModels(body.askModelIds)
    const freeActModelId =
      resolveFreeTierChatModelId(body.actModelId) ??
      freeAskModelIds[0] ??
      FREE_TIER_DEFAULT_MODEL_ID
    const paidModels = normalizePaidChatModels(body.askModelIds, body.actModelId)
    const id = await repository.createConversation({
      userId: resourceUserId,
      workspaceId: context.workspace.workspace.id,
      conversationType: body.conversationType ?? 'personal',
      createdByPrincipalId: context.workspace.principal.id,
      clientId: body.clientId?.trim() || undefined,
      title: body.title || 'New Chat',
      projectId: body.projectId ?? undefined,
      askModelIds: isFreeTier ? freeAskModelIds : paidModels.askModelIds,
      actModelId: isFreeTier ? freeActModelId : paidModels.actModelId,
      lastMode: body.lastMode,
    })
    if (body.knowledgeBaseId) {
      try {
        await getOverlayServerContext().knowledgeBaseService.attachConversation({
          conversationId: id,
          knowledgeBaseId: body.knowledgeBaseId,
          userId: resourceUserId,
        })
      } catch (error) {
        await repository.deleteConversation({
          conversationId: id,
          userId: resourceUserId,
          workspaceId: context.workspace.workspace.id,
        }).catch((_error) => {})
        throw error
      }
    }
    const conversation = await repository.getConversationById({
      conversationId: id,
      userId: resourceUserId,
      workspaceId: context.workspace.workspace.id,
    })
    return NextResponse.json({
      id,
      conversation: conversation
        ? { ...conversation, knowledgeBaseId: body.knowledgeBaseId }
        : conversation,
    })
  } catch (error) {
    logger.error('[conversations POST]', error)
    if (error instanceof KnowledgeBaseServiceError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode })
    }
    return NextResponse.json({ error: 'Failed to create conversation' }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest, context: AppApiRouteContext) {
  try {
    const body = await request.json() as {
      conversationId?: string
      title?: string
      projectId?: string | null
      askModelIds?: string[]
      actModelId?: string
      lastMode?: 'ask' | 'act'
      accessToken?: string
      userId?: string
      knowledgeBaseId?: string | null
    }
    const { auth } = context
    const resourceUserId = getAuthorizedResourceUserId(context)
    const { appData, chatUsagePolicy } = getOverlayServerContext()
    const repository = appData.repositories.conversations
    if (!body.conversationId) {
      return NextResponse.json({ error: 'conversationId required' }, { status: 400 })
    }

    let askModelIds = body.askModelIds
    let actModelId = body.actModelId
    if (body.askModelIds !== undefined || body.actModelId !== undefined) {
      const entitlements = await chatUsagePolicy.getEntitlements({ userId: auth.userId })
      const isFreeTier = !entitlements || !canUsePaidBudgetFeatures(entitlements)
      if (isFreeTier) {
        const freeAskModelIds = body.askModelIds !== undefined
          ? clampFreeTierAskModels(body.askModelIds)
          : undefined
        askModelIds = freeAskModelIds
        actModelId = body.actModelId !== undefined
          ? resolveFreeTierChatModelId(body.actModelId) ?? freeAskModelIds?.[0] ?? FREE_TIER_DEFAULT_MODEL_ID
          : undefined
      } else {
        const normalized = normalizePaidChatModels(body.askModelIds, body.actModelId)
        askModelIds = body.askModelIds !== undefined ? normalized.askModelIds : undefined
        actModelId = body.actModelId !== undefined ? normalized.actModelId : undefined
      }
    }

    await repository.updateConversation({
      conversationId: body.conversationId as Id<'conversations'>,
      userId: resourceUserId,
      workspaceId: context.workspace.workspace.id,
      title: body.title,
      projectId: body.projectId,
      askModelIds,
      actModelId,
      lastMode: body.lastMode,
    })
    if (body.knowledgeBaseId === null) {
      await getOverlayServerContext().knowledgeBaseService.detachConversation({
        conversationId: body.conversationId,
        userId: resourceUserId,
      })
    } else if (body.knowledgeBaseId) {
      await getOverlayServerContext().knowledgeBaseService.attachConversation({
        conversationId: body.conversationId,
        knowledgeBaseId: body.knowledgeBaseId,
        userId: resourceUserId,
      })
    }
    const conversation = await repository.getConversationById({
      conversationId: body.conversationId as Id<'conversations'>,
      userId: resourceUserId,
      workspaceId: context.workspace.workspace.id,
    })
    const knowledgeBase = await getOverlayServerContext().knowledgeBaseService
      .getConversationKnowledgeBase({
        conversationId: body.conversationId,
        userId: resourceUserId,
      })
    return NextResponse.json({
      success: true,
      conversation: conversation ? { ...conversation, knowledgeBaseId: knowledgeBase?.id } : conversation,
    })
  } catch (error) {
    logger.error('[conversations PATCH]', error)
    if (error instanceof KnowledgeBaseServiceError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode })
    }
    return NextResponse.json({ error: 'Failed to update conversation' }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest, context: AppApiRouteContext) {
  try {
    const { auth } = context
    const { appData } = getOverlayServerContext()
    const repository = appData.repositories.conversations

    const conversationId = request.nextUrl.searchParams.get('conversationId')
    if (!conversationId) return NextResponse.json({ error: 'conversationId required' }, { status: 400 })

    await getOverlayServerContext().knowledgeBaseService.detachConversation({
      conversationId,
      userId: auth.userId,
    })
    await repository.deleteConversation({
      conversationId: conversationId as Id<'conversations'>,
      userId: auth.userId,
      workspaceId: context.workspace.workspace.id,
    })
    return NextResponse.json({ success: true, conversationId, deletedAt: Date.now() })
  } catch (error) {
    logger.error('[conversations DELETE]', error)
    return NextResponse.json({ error: 'Failed to delete conversation' }, { status: 500 })
  }
}

function serializeConversationMessage(message: ConversationMessageRow) {
  return {
    id: message._id,
    turnId: message.turnId,
    mode: message.mode,
    contentType: message.contentType,
    variantIndex: message.variantIndex,
    createdAt: message.createdAt,
    ...(message.eventSequence !== undefined ? { eventSequence: message.eventSequence } : {}),
    role: message.role,
    authorKind: message.authorKind,
    ...(message.authorPrincipalId ? { authorPrincipalId: message.authorPrincipalId } : {}),
    // Rooms need the raw body and the thread anchor: without them a reply
    // cannot be filtered out of the main transcript.
    content: message.content,
    ...(message.threadRootMessageId ? { threadRootMessageId: message.threadRootMessageId } : {}),
    parts: message.parts?.length
      ? message.parts.map(serializeConversationMessagePart)
      : [{ type: 'text' as const, text: message.content }],
    model: message.modelId,
    ...(message.replyToTurnId ? { replyToTurnId: message.replyToTurnId } : {}),
    ...(message.replySnippet ? { replySnippet: message.replySnippet } : {}),
    ...(message.routedModelId ? { routedModelId: message.routedModelId } : {}),
    ...(message.status ? { status: message.status } : {}),
    ...(message.clientNonce ? { clientNonce: message.clientNonce } : {}),
    ...(message.editedAt ? { editedAt: message.editedAt } : {}),
    ...(message.deletedAt ? { deletedAt: message.deletedAt } : {}),
  }
}

function serializeConversationMessagePart(part: Record<string, unknown>) {
  if (
    part.type === 'data' &&
    part.dataType === GENERATED_UI_DATA_TYPE
  ) {
    const normalized = normalizeGeneratedUiData(part.data)
    if (normalized) {
      return {
        type: 'data' as const,
        id: typeof part.id === 'string' ? part.id : undefined,
        dataType: GENERATED_UI_DATA_TYPE,
        data: normalized,
        ...(part.transient === true ? { transient: true } : {}),
      }
    }
  }
  if (part.type === 'tool-invocation' && part.toolInvocation) {
    return {
      type: 'tool-invocation' as const,
      toolInvocation: part.toolInvocation,
    }
  }
  return {
    type: typeof part.type === 'string' ? part.type : 'text',
    text: typeof part.text === 'string' ? part.text : undefined,
    url: typeof part.url === 'string' ? part.url : undefined,
    mediaType: typeof part.mediaType === 'string' ? part.mediaType : undefined,
    fileName: typeof part.fileName === 'string' ? part.fileName : undefined,
    state: typeof part.state === 'string' ? part.state : undefined,
  }
}
