import 'server-only'

import { getOverlayServerContext } from '@/server/bootstrap'
import type { SharedConversation } from '@/shared/chat/shared-conversation'

export async function loadSharedConversation(token: string): Promise<SharedConversation | null> {
  const normalizedToken = token.trim()
  if (!normalizedToken) return null
  const conversation = await getOverlayServerContext()
    .appData.repositories.conversations
    .getPublicConversationByToken({ token: normalizedToken })
  if (!conversation) return null
  return {
    _id: conversation._id,
    title: conversation.title,
    createdAt: conversation.createdAt,
    sharedAt: conversation.sharedAt,
    messages: conversation.messages.map((message) => ({
      _id: message._id,
      role: message.role,
      mode: message.mode,
      content: message.content,
      contentType: message.contentType,
      parts: (message.parts ?? null) as SharedConversation['messages'][number]['parts'],
      modelId: message.modelId ?? null,
      variantIndex: message.variantIndex,
      turnId: message.turnId,
      createdAt: message.createdAt,
    })),
  }
}
