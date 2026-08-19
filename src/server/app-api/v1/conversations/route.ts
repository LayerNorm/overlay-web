import { logger } from '@/server/observability/logger'
import { NextRequest, NextResponse } from 'next/server'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import { paginateArray } from '@/server/app-api/pagination-core'
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
    const includeMessages = searchParams.get('messages') === 'true'
    const projectId = searchParams.get('projectId')
    const updatedSinceParam = searchParams.get('updatedSince')
    const updatedSince = updatedSinceParam ? Number(updatedSinceParam) : undefined
    const includeDeleted = readBooleanParam(searchParams.get('includeDeleted'))
    const messageLimit = readPositiveIntParam(searchParams.get('limit'), 100)
    const beforeCreatedAtParam = searchParams.get('beforeCreatedAt')
    const beforeCreatedAt = beforeCreatedAtParam ? Number(beforeCreatedAtParam) : undefined
    const compactToolPayloads = readBooleanParam(searchParams.get('compactToolPayloads')) === true
    const mainOnly = readBooleanParam(searchParams.get('mainOnly')) === true
    const messageId = searchParams.get('messageId')?.trim() || undefined
    const threadRootMessageId = searchParams.get('threadRootMessageId')?.trim() || undefined

    if (conversationId && !includeMessages) {
      const conv = await repository.getConversationById({
        conversationId: conversationId as Id<'conversations'>,
        userId: auth.userId,
        workspaceId: context.workspace.workspace.id,
      }) ?? await appData.repositories.conversationCollaboration.getAccessibleConversation({
        actorUserId: auth.userId,
        conversationId,
        workspaceId: context.workspace.workspace.id,
      })
      if (!conv) return NextResponse.json({ error: 'Not found' }, { status: 404 })
      return NextResponse.json(conv)
    }

    if (conversationId && includeMessages) {
      const conv = await repository.getConversationById({
        conversationId: conversationId as Id<'conversations'>,
        userId: auth.userId,
        workspaceId: context.workspace.workspace.id,
      }) ?? await appData.repositories.conversationCollaboration.getAccessibleConversation({
        actorUserId: auth.userId,
        conversationId,
        workspaceId: context.workspace.workspace.id,
      })
      if (!conv) return NextResponse.json({ error: 'Not found' }, { status: 404 })

      let messages: ConversationMessageRow[]
      if ((conv.conversationType ?? 'personal') !== 'personal') {
        messages = await appData.repositories.conversationCollaboration.listMessages({
          actorUserId: auth.userId,
          conversationId,
          workspaceId: context.workspace.workspace.id,
          limit: messageLimit ?? 100,
          ...(Number.isFinite(beforeCreatedAt) ? { beforeCreatedAt } : {}),
          ...(mainOnly ? { mainOnly: true } : {}),
          ...(messageId ? { messageId } : {}),
          ...(threadRootMessageId ? { threadRootMessageId } : {}),
        })
      } else if (messageLimit) {
        try {
          messages = await repository.getRecentMessages({
            conversationId: conversationId as Id<'conversations'>,
            userId: auth.userId,
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
            userId: auth.userId,
          })
        }
      } else {
        messages = await repository.getConversationMessages({
          conversationId: conversationId as Id<'conversations'>,
          userId: auth.userId,
        })
      }

      const earliestCreatedAt = messages.length
        ? Math.min(...messages.map((message) => message.createdAt))
        : undefined

      return NextResponse.json({
        conversationId,
        title: conv.title,
        conversationType: conv.conversationType ?? 'personal',
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
        workspaceId: context.workspace.workspace.id,
        ...(Number.isFinite(updatedSince) ? { updatedSince } : {}),
        ...(includeDeleted !== undefined ? { includeDeleted } : {}),
      })
      return NextResponse.json(list)
    }

    // Archived view. These are exactly the rows the default list subtracts.
    if (request.nextUrl.searchParams.get('archived') === 'true') {
      const list = await appData.repositories.conversationCollaboration.listArchivedConversations({
        actorUserId: auth.userId,
        workspaceId: context.workspace.workspace.id,
      })
      return NextResponse.json(list)
    }

    const [personal, accessible, archived] = await Promise.all([
      repository.listConversations({
        userId: auth.userId,
        workspaceId: context.workspace.workspace.id,
        ...(Number.isFinite(updatedSince) ? { updatedSince } : {}),
        ...(includeDeleted !== undefined ? { includeDeleted } : {}),
      }),
      appData.repositories.conversationCollaboration.listAccessibleConversations({
        actorUserId: auth.userId,
        workspaceId: context.workspace.workspace.id,
      }),
      appData.repositories.conversationCollaboration.listArchivedConversations({
        actorUserId: auth.userId,
        workspaceId: context.workspace.workspace.id,
      }),
    ])
    // Keep personal conversations on the personal repository branch, but take
    // collaboration conversations from the participant-scoped branch so DM
    // metadata (including participant composition) remains available to the UI.
    const archivedIds = new Set(archived.map((conversation) => String(conversation._id)))
    const list = [
      ...personal.filter((conversation) => (
        (conversation.conversationType ?? 'personal') === 'personal'
        && !archivedIds.has(String(conversation._id))
      )),
      ...accessible.filter((conversation) => (
        (conversation.conversationType ?? 'personal') !== 'personal'
        && !archivedIds.has(String(conversation._id))
      )),
    ]
      .map((conversation) => ({
        ...conversation,
        // paginateArray sorts on updatedAt; collaboration rows may only set lastModified.
        updatedAt: conversation.updatedAt ?? conversation.lastModified ?? conversation.createdAt ?? 0,
      }))
      .sort((left, right) => right.lastModified - left.lastModified)

    const view = searchParams.get('view')
    const filtered = view === 'dms'
      ? list.filter((conversation) => conversation.conversationType === 'dm')
      : view === 'channels'
        ? list.filter((conversation) => conversation.conversationType === 'channel')
        : view === 'all'
          ? list
          : list.filter((conversation) => (conversation.conversationType ?? 'personal') === 'personal')

    // Client list cache expects a paginated envelope. Filtering by view before
    // pagination keeps "Load more" truthful for DMs/channels (client-side type
    // filters on a mixed page left users with 2 visible rows + a Load more).
    if (
      searchParams.has('limit')
      || searchParams.has('cursor')
      || searchParams.has('sort')
      || searchParams.has('order')
      || searchParams.has('view')
    ) {
      const pageQuery = new URLSearchParams(searchParams)
      if (!pageQuery.has('sort')) pageQuery.set('sort', 'updatedAt')
      if (!pageQuery.has('order')) pageQuery.set('order', 'desc')
      return NextResponse.json(paginateArray(filtered, pageQuery))
    }

    return NextResponse.json(filtered)
  } catch (error) {
    logger.error('[conversations GET]', error)
    return NextResponse.json({ error: 'Failed to fetch conversations' }, { status: 500 })
  }
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
      userId: auth.userId,
      workspaceId: context.workspace.workspace.id,
      clientId: body.clientId?.trim() || undefined,
      title: body.title || 'New Chat',
      projectId: body.projectId ?? undefined,
      askModelIds: isFreeTier ? freeAskModelIds : paidModels.askModelIds,
      actModelId: isFreeTier ? freeActModelId : paidModels.actModelId,
      lastMode: body.lastMode,
    })
    const conversation = await repository.getConversationById({
      conversationId: id,
      userId: auth.userId,
      workspaceId: context.workspace.workspace.id,
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
      userId: auth.userId,
      workspaceId: context.workspace.workspace.id,
      title: body.title,
      projectId: body.projectId,
      askModelIds,
      actModelId,
      lastMode: body.lastMode,
    })
    const conversation = await repository.getConversationById({
      conversationId: body.conversationId as Id<'conversations'>,
      userId: auth.userId,
      workspaceId: context.workspace.workspace.id,
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
    const collaboration = appData.repositories.conversationCollaboration

    const conversationId = request.nextUrl.searchParams.get('conversationId')
    if (!conversationId) return NextResponse.json({ error: 'conversationId required' }, { status: 400 })
    const conversation = await collaboration.getAccessibleConversation({
      actorUserId: auth.userId,
      conversationId,
      workspaceId: context.workspace.workspace.id,
    })
    const collaborationType = conversation?.conversationType === 'dm' || conversation?.conversationType === 'channel'
    if (collaborationType) {
      const scope = request.nextUrl.searchParams.get('scope') ?? 'self'
      if (scope === 'everyone') {
        if (context.workspace.membership.role !== 'owner') {
          return NextResponse.json({ error: 'Workspace owner required' }, { status: 403 })
        }
        const deleted = await collaboration.deleteConversationForEveryone({
          actorUserId: auth.userId,
          conversationId,
          workspaceId: context.workspace.workspace.id,
        })
        if (!deleted) return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })
      } else if (scope === 'self') {
        const removed = await collaboration.removeParticipant({
          actorUserId: auth.userId,
          conversationId,
          principalId: context.workspace.principal.id,
          workspaceId: context.workspace.workspace.id,
        })
        if (!removed) return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })
      } else {
        return NextResponse.json({ error: 'Invalid delete scope' }, { status: 400 })
      }
      return NextResponse.json({ success: true, conversationId, scope, deletedAt: Date.now() })
    }

    await repository.deleteConversation({
      conversationId: conversationId as Id<'conversations'>,
      userId: auth.userId,
      workspaceId: context.workspace.workspace.id,
    })
    return NextResponse.json({ success: true, conversationId, scope: 'self', deletedAt: Date.now() })
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
    ...(message.authorKind ? { authorKind: message.authorKind } : {}),
    ...(message.authorPrincipalId ? { authorPrincipalId: message.authorPrincipalId } : {}),
    ...(message.importedAuthorName ? { importedAuthorName: message.importedAuthorName } : {}),
    ...(message.importedAuthorEmail ? { importedAuthorEmail: message.importedAuthorEmail } : {}),
    ...(message.importedAuthorStatus ? { importedAuthorStatus: message.importedAuthorStatus } : {}),
    ...(message.clientNonce ? { clientNonce: message.clientNonce } : {}),
    ...(message.editedAt ? { editedAt: message.editedAt } : {}),
    ...(message.editHistory?.length ? { editHistory: message.editHistory } : {}),
    ...(message.deletedAt ? { deletedAt: message.deletedAt } : {}),
    ...(message.threadRootMessageId ? { threadRootMessageId: message.threadRootMessageId } : {}),
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
