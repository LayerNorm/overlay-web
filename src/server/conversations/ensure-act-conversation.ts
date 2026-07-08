import 'server-only'

import { canUsePaidBudgetFeatures } from '@/server/billing/billing-runtime'
import {
  DEFAULT_MODEL_ID,
  FREE_TIER_DEFAULT_MODEL_ID,
  resolveFreeTierChatModelId,
} from '@/shared/ai/gateway/model-types'
import { normalizeChatModelSelection } from '@/shared/chat/chat-model-prefs'
import type { Entitlements } from '@/shared/app/app-contracts'
import type { ActConversationRepository } from './ActConversationRepository'
import type { Id } from '../../../convex/_generated/dataModel'

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

export async function ensureActConversationId(params: {
  userId: string
  repository: Pick<ActConversationRepository, 'createConversation'>
  conversationClientId: string
  entitlements: Entitlements
  title?: string
  projectId?: string
  askModelIds?: string[]
  actModelId?: string
}): Promise<Id<'conversations'>> {
  const clientId = params.conversationClientId.trim()
  if (!clientId) {
    throw new Error('conversationClientId required')
  }

  const isFreeTier = !canUsePaidBudgetFeatures(params.entitlements)
  const freeAskModelIds = clampFreeTierAskModels(params.askModelIds)
  const freeActModelId =
    resolveFreeTierChatModelId(params.actModelId) ??
    freeAskModelIds[0] ??
    FREE_TIER_DEFAULT_MODEL_ID
  const paidModels = normalizePaidChatModels(params.askModelIds, params.actModelId)

  const id = await params.repository.createConversation({
    userId: params.userId,
    clientId,
    title: params.title || 'New Chat',
    projectId: params.projectId ?? undefined,
    askModelIds: isFreeTier ? freeAskModelIds : paidModels.askModelIds,
    actModelId: isFreeTier ? freeActModelId : paidModels.actModelId,
    lastMode: 'act',
  })
  if (!id) {
    throw new Error('Failed to create conversation')
  }
  return id
}
