import { logger } from '@/server/observability/logger'
import { NextRequest, NextResponse } from 'next/server'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import { getInternalApiSecret } from '@/server/shared/internal-api-secret'
import {
  DEFAULT_MODEL_ID,
  FREE_TIER_DEFAULT_MODEL_ID,
  resolveFreeTierChatModelId,
} from '@/shared/ai/gateway/model-types'
import { normalizeChatModelSelection } from '@/shared/chat/chat-model-prefs'
import { canUsePaidBudgetFeatures } from '@/server/billing/billing-runtime'
import { lazyConvex as convex } from '@/server/database/lazy-convex'
import {
  GENERATED_UI_DATA_TYPE,
  normalizeGeneratedUiData,
} from '@overlay/chat-core/generated-ui'
import type { Id } from '../../../../../convex/_generated/dataModel'

type ConversationDoc = {
  _id: string
  userId: string
  clientId?: string
  title: string
  lastModified: number
  createdAt: number
  updatedAt: number
  deletedAt?: number
  lastMode: 'ask' | 'act'
  askModelIds: string[]
  actModelId: string
  projectId?: string
}

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
    const serverSecret = getInternalApiSecret()

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

    if (conversationId && !includeMessages) {
      const conv = await convex.query<ConversationDoc | null>('chat/conversations:get', {
        conversationId: conversationId as Id<'conversations'>,
        userId: auth.userId,
        serverSecret,
      })
      if (!conv) return NextResponse.json({ error: 'Not found' }, { status: 404 })
      return NextResponse.json(conv)
    }

    if (conversationId && includeMessages) {
      const conv = await convex.query<ConversationDoc | null>('chat/conversations:get', {
        conversationId: conversationId as Id<'conversations'>,
        userId: auth.userId,
        serverSecret,
      })
      if (!conv) return NextResponse.json({ error: 'Not found' }, { status: 404 })

      type ConversationMessageRow = {
        _id: string
        turnId: string
        role: 'user' | 'assistant'
        mode: 'ask' | 'act'
        content: string
        contentType: 'text' | 'image' | 'video'
        parts?: Array<
          | { type: 'data'; id: string; dataType: 'overlay.generated_ui'; data: unknown; transient?: boolean }
          | { type: string; text?: string; url?: string; mediaType?: string; fileName?: string; state?: string }
          | {
              type: 'tool-invocation'
              toolInvocation: {
                toolCallId?: string
                toolName: string
                state?: string
                toolInput?: Record<string, unknown>
                toolOutput?: unknown
              }
            }
        >
        modelId?: string
        variantIndex?: number
        createdAt: number
        replyToTurnId?: string
        replySnippet?: string
        routedModelId?: string
        status?: 'generating' | 'completed' | 'error'
      }
      let messages: ConversationMessageRow[]
      if (messageLimit) {
        try {
          messages = await convex.query<ConversationMessageRow[]>('chat/conversations:getRecentMessages', {
            conversationId: conversationId as Id<'conversations'>,
            userId: auth.userId,
            serverSecret,
            limit: messageLimit,
            ...(Number.isFinite(beforeCreatedAt) ? { beforeCreatedAt } : {}),
            compactToolPayloads,
          }) ?? []
        } catch (error) {
          logger.warn('[conversations GET] Falling back to full message load after recent load failed', {
            conversationId,
            error: error instanceof Error ? error.message : String(error),
          })
          messages = await convex.query<ConversationMessageRow[]>('chat/conversations:getMessages', {
            conversationId: conversationId as Id<'conversations'>,
            userId: auth.userId,
            serverSecret,
          }) ?? []
        }
      } else {
        messages = await convex.query<
        Array<{
          _id: string
          turnId: string
          role: 'user' | 'assistant'
          mode: 'ask' | 'act'
          content: string
          contentType: 'text' | 'image' | 'video'
          parts?: Array<
            | { type: 'data'; id: string; dataType: 'overlay.generated_ui'; data: unknown; transient?: boolean }
            | { type: string; text?: string; url?: string; mediaType?: string; fileName?: string; state?: string }
            | {
                type: 'tool-invocation'
                toolInvocation: {
                  toolCallId?: string
                  toolName: string
                  state?: string
                  toolInput?: Record<string, unknown>
                  toolOutput?: unknown
                }
              }
          >
          modelId?: string
          variantIndex?: number
          createdAt: number
          replyToTurnId?: string
          replySnippet?: string
          routedModelId?: string
          status?: 'generating' | 'completed' | 'error'
        }>
        >('chat/conversations:getMessages', {
          conversationId: conversationId as Id<'conversations'>,
          userId: auth.userId,
          serverSecret,
        }) ?? []
      }

      const earliestCreatedAt = messages?.length
        ? Math.min(...messages.map((message) => message.createdAt))
        : undefined

      return NextResponse.json({
        ...(messageLimit ? {
          limit: messageLimit,
          hasMore: (messages?.length ?? 0) >= messageLimit,
          earliestCreatedAt,
        } : {}),
        messages: (messages || []).map((message) => ({
          id: message._id,
          turnId: message.turnId,
          mode: message.mode,
          contentType: message.contentType,
          variantIndex: message.variantIndex,
          createdAt: message.createdAt,
          role: message.role,
          parts: message.parts?.length
            ? message.parts.map((part) => {
                if (
                  part.type === 'data' &&
                  'dataType' in part &&
                  part.dataType === GENERATED_UI_DATA_TYPE
                ) {
                  const normalized = normalizeGeneratedUiData((part as { data?: unknown }).data)
                  if (normalized) {
                    return {
                      type: 'data' as const,
                      id: (part as { id?: string }).id,
                      dataType: GENERATED_UI_DATA_TYPE,
                      data: normalized,
                      ...((part as { transient?: boolean }).transient ? { transient: true } : {}),
                    }
                  }
                }
                if (part.type === 'tool-invocation' && 'toolInvocation' in part && part.toolInvocation) {
                  return {
                    type: 'tool-invocation' as const,
                    toolInvocation: part.toolInvocation,
                  }
                }
                const p = part as {
                  type: string
                  text?: string
                  url?: string
                  mediaType?: string
                  fileName?: string
                  state?: string
                }
                return {
                  type: p.type,
                  text: p.text,
                  url: p.url,
                  mediaType: p.mediaType,
                  fileName: p.fileName,
                  state: p.state,
                }
              })
            : [{ type: 'text' as const, text: message.content }],
          model: message.modelId,
          ...(message.replyToTurnId ? { replyToTurnId: message.replyToTurnId } : {}),
          ...(message.replySnippet ? { replySnippet: message.replySnippet } : {}),
          ...(message.routedModelId ? { routedModelId: message.routedModelId } : {}),
          ...(message.status ? { status: message.status } : {}),
        })),
      })
    }

    if (projectId) {
      const list = await convex.query<ConversationDoc[]>('chat/conversations:listByProject', {
        projectId,
        userId: auth.userId,
        serverSecret,
        ...(Number.isFinite(updatedSince) ? { updatedSince } : {}),
        ...(includeDeleted !== undefined ? { includeDeleted } : {}),
      })
      return NextResponse.json(list || [])
    }

    const list = await convex.query<ConversationDoc[]>('chat/conversations:list', {
      userId: auth.userId,
      serverSecret,
      ...(Number.isFinite(updatedSince) ? { updatedSince } : {}),
      ...(includeDeleted !== undefined ? { includeDeleted } : {}),
    })

    return NextResponse.json(list || [])
  } catch (_error) {
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
    const serverSecret = getInternalApiSecret()
    const entitlements = await convex.query<{
      tier: 'free' | 'pro' | 'max'
      planKind?: 'free' | 'paid'
      creditsUsed: number
      creditsTotal: number
      budgetUsedCents?: number
      budgetTotalCents?: number
      budgetRemainingCents?: number
    } | null>(
      'platform/usage:getEntitlementsByServer',
      {
        userId: auth.userId,
        serverSecret,
      },
      { throwOnError: true },
    )
    const isFreeTier = !entitlements || !canUsePaidBudgetFeatures(entitlements)
    const freeAskModelIds = clampFreeTierAskModels(body.askModelIds)
    const freeActModelId =
      resolveFreeTierChatModelId(body.actModelId) ??
      freeAskModelIds[0] ??
      FREE_TIER_DEFAULT_MODEL_ID
    const paidModels = normalizePaidChatModels(body.askModelIds, body.actModelId)
    const id = await convex.mutation<Id<'conversations'>>('chat/conversations:create', {
      userId: auth.userId,
      serverSecret,
      clientId: body.clientId?.trim() || undefined,
      title: body.title || 'New Chat',
      projectId: body.projectId ?? undefined,
      askModelIds: isFreeTier ? freeAskModelIds : paidModels.askModelIds,
      actModelId: isFreeTier ? freeActModelId : paidModels.actModelId,
      lastMode: body.lastMode,
    })
    const conversation = await convex.query<ConversationDoc | null>('chat/conversations:get', {
      conversationId: id,
      userId: auth.userId,
      serverSecret,
    })
    return NextResponse.json({ id, conversation })
  } catch (_error) {
    return NextResponse.json({ error: 'Failed to create conversation' }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest, context: AppApiRouteContext) {
  try {
    const body = await request.json() as {
      conversationId?: string
      title?: string
      projectId?: string
      askModelIds?: string[]
      actModelId?: string
      lastMode?: 'ask' | 'act'
      accessToken?: string
      userId?: string
    }
    const { auth } = context
    const serverSecret = getInternalApiSecret()
    if (!body.conversationId) {
      return NextResponse.json({ error: 'conversationId required' }, { status: 400 })
    }

    let askModelIds = body.askModelIds
    let actModelId = body.actModelId
    if (body.askModelIds !== undefined || body.actModelId !== undefined) {
      const entitlements = await convex.query<{
        tier: 'free' | 'pro' | 'max'
        planKind?: 'free' | 'paid'
        creditsUsed: number
        creditsTotal: number
        budgetUsedCents?: number
        budgetTotalCents?: number
        budgetRemainingCents?: number
      } | null>(
        'platform/usage:getEntitlementsByServer',
        { userId: auth.userId, serverSecret },
        { throwOnError: true },
      )
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

    await convex.mutation('chat/conversations:update', {
      conversationId: body.conversationId as Id<'conversations'>,
      userId: auth.userId,
      serverSecret,
      title: body.title,
      projectId: body.projectId,
      askModelIds,
      actModelId,
      lastMode: body.lastMode,
    })
    const conversation = await convex.query<ConversationDoc | null>('chat/conversations:get', {
      conversationId: body.conversationId as Id<'conversations'>,
      userId: auth.userId,
      serverSecret,
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
    const serverSecret = getInternalApiSecret()

    const conversationId = request.nextUrl.searchParams.get('conversationId')
    if (!conversationId) return NextResponse.json({ error: 'conversationId required' }, { status: 400 })

    await convex.mutation('chat/conversations:remove', {
      conversationId: conversationId as Id<'conversations'>,
      userId: auth.userId,
      serverSecret,
    })
    return NextResponse.json({ success: true, conversationId, deletedAt: Date.now() })
  } catch (_error) {
    return NextResponse.json({ error: 'Failed to delete conversation' }, { status: 500 })
  }
}
