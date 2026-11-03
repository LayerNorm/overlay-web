import 'server-only'

import { DEFAULT_MODEL_ID } from '@/shared/ai/gateway/model-types'
import { normalizeChatModelSelection } from '@/shared/chat/chat-model-prefs'
import type { Entitlements } from '@/shared/app/app-contracts'
import type { ActConversationRepository, ConversationId } from './ActConversationRepository'

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
  scope?: 'personal' | 'workspace'
  entitlements: Entitlements
  title?: string
  askModelIds?: string[]
  actModelId?: string
  workspaceId?: string
  createdByPrincipalId?: string
}): Promise<ConversationId> {
  const clientId = params.conversationClientId.trim()
  if (!clientId) {
    throw new Error('conversationClientId required')
  }

  const paidModels = normalizePaidChatModels(params.askModelIds, params.actModelId)

  const id = await params.repository.createConversation({
    userId: params.userId,
    clientId,
    scope: params.scope,
    workspaceId: params.workspaceId,
    createdByPrincipalId: params.createdByPrincipalId,
    title: params.title || 'New Chat',
    askModelIds: paidModels.askModelIds,
    actModelId: paidModels.actModelId,
    lastMode: 'act',
  })
  if (!id) {
    throw new Error('Failed to create conversation')
  }
  return id
}
