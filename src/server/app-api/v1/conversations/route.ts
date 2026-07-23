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
    const compactToolPayloads = readBooleanParam(searchParams.get('compactToolPayloads')) === true

    if (conversationId && !includeMessages) {
      const conv = await repository.getConversationById({
        conversationId: conversationId as Id<'conversations'>,
        userId: resourceUserId,
      })
      if (!conv) return NextResponse.json({ error: 'Not found' }, { status: 404 })
      return NextResponse.json(conv)
    }

    if (conversationId && includeMessages) {
      const conv = await repository.getConversationById({
        conversationId: conversationId as Id<'conversations'>,
        userId: resourceUserId,
      })
      if (!conv) return NextResponse.json({ error: 'Not found' }, { status: 404 })

      let messages: ConversationMessageRow[]
      if (messageLimit) {
        try {
          messages = await repository.getRecentMessages({
            conversationId: conversationId as Id<'conversations'>,
            userId: resourceUserId,
            limit: messageLimit,
            ...(Number.isFinite(beforeCreatedAt) ? { beforeCreatedAt } : {}),
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
          })
        }
      } else {
        messages = await repository.getConversationMessages({
          conversationId: conversationId as Id<'conversations'>,
          userId: resourceUserId,
        })
      }

      const earliestCreatedAt = messages.length
        ? Math.min(...messages.map((message) => message.createdAt))
        : undefined

      return NextResponse.json({
        ...(messageLimit ? {
          limit: messageLimit,
          hasMore: messages.length >= messageLimit,
          earliestCreatedAt,
        } : {}),
        messages: messages.map(serializeConversationMessage),
      })
    }

    if (projectId) {
      const list = await repository.listConversationsByProject({
        projectId,
        userId: auth.userId,
        ...(Number.isFinite(updatedSince) ? { updatedSince } : {}),
        ...(includeDeleted !== undefined ? { includeDeleted } : {}),
      })
      const granted = await loadGrantedConversations(context, repository)
      return NextResponse.json([...list, ...granted].filter((conversation) => (
        conversation.projectId === projectId &&
        (!Number.isFinite(updatedSince) || (conversation.updatedAt ?? conversation.lastModified) >= updatedSince!) &&
        (includeDeleted === true || !conversation.deletedAt)
      )))
    }

    const list = await repository.listConversations({
      userId: auth.userId,
      ...(Number.isFinite(updatedSince) ? { updatedSince } : {}),
      ...(includeDeleted !== undefined ? { includeDeleted } : {}),
    })

    return NextResponse.json([...list, ...await loadGrantedConversations(context, repository)])
  } catch (error) {
    logger.error('[conversations GET]', error)
    return NextResponse.json({ error: 'Failed to fetch conversations' }, { status: 500 })
  }
}

async function loadGrantedConversations(
  context: AppApiRouteContext,
  repository: ReturnType<typeof getOverlayServerContext>['appData']['repositories']['conversations'],
) {
  const values = await Promise.all(getGrantedResources(context).map(({ ownerUserId, resourceId }) => (
    repository.getConversationById({
      conversationId: resourceId as Id<'conversations'>,
      userId: ownerUserId,
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
      accessToken?: string
      userId?: string
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
      clientId: body.clientId?.trim() || undefined,
      title: body.title || 'New Chat',
      projectId: body.projectId ?? undefined,
      askModelIds: isFreeTier ? freeAskModelIds : paidModels.askModelIds,
      actModelId: isFreeTier ? freeActModelId : paidModels.actModelId,
      lastMode: body.lastMode,
    })
    const conversation = await repository.getConversationById({
      conversationId: id,
      userId: resourceUserId,
    })
    return NextResponse.json({ id, conversation })
  } catch (error) {
    logger.error('[conversations POST]', error)
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
      title: body.title,
      projectId: body.projectId,
      askModelIds,
      actModelId,
      lastMode: body.lastMode,
    })
    const conversation = await repository.getConversationById({
      conversationId: body.conversationId as Id<'conversations'>,
      userId: auth.userId,
    })
    return NextResponse.json({ success: true, conversation })
  } catch (error) {
    logger.error('[conversations PATCH]', error)
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

    await repository.deleteConversation({
      conversationId: conversationId as Id<'conversations'>,
      userId: auth.userId,
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
    role: message.role,
    parts: message.parts?.length
      ? message.parts.map(serializeConversationMessagePart)
      : [{ type: 'text' as const, text: message.content }],
    model: message.modelId,
    ...(message.replyToTurnId ? { replyToTurnId: message.replyToTurnId } : {}),
    ...(message.replySnippet ? { replySnippet: message.replySnippet } : {}),
    ...(message.routedModelId ? { routedModelId: message.routedModelId } : {}),
    ...(message.status ? { status: message.status } : {}),
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
