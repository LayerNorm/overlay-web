'use client'

import {
  useCallback,
  type MutableRefObject,
} from 'react'
import posthog from 'posthog-js'
import type { UIMessage } from '@/shared/chat/ai-ui-message'
import { normalizeChatModelSelection } from '@/shared/chat/chat-model-prefs'
import {
  getUserTurnId,
  stripAssistantAfterUserTurn,
} from '@overlay/chat-core'
import {
  reportTextStreamError,
  startActRetryStream,
} from '../useChatTransport'
import type {
  ChatMessageMetadata,
  ConversationRuntime,
} from '../chat-interface/types'

export function useChatRetryController({
  activeChatId,
  activeChatIdRef,
  activeChatTitle,
  automationIdParam,
  completeSession,
  ensureConversationRuntime,
  isActiveLoading,
  loadChats,
  loadSubscription,
  mode,
  selectedActModel,
  shouldScrollRef,
  startSession,
}: {
  activeChatId: string | null
  activeChatIdRef: MutableRefObject<string | null>
  activeChatTitle: string | null
  automationIdParam: string | null
  completeSession: (chatId: string, active: boolean) => void
  ensureConversationRuntime: (chatId: string) => ConversationRuntime
  isActiveLoading: boolean
  loadChats: () => Promise<void>
  loadSubscription: () => Promise<unknown>
  mode: 'chat' | 'automate'
  selectedActModel: string
  shouldScrollRef: MutableRefObject<boolean>
  startSession: (
    chatId: string,
    mode: 'act',
    title: string,
    exchangeIndex: number,
  ) => void
}) {
  const handleRetryExchange = useCallback(
    async (
      userMsg: UIMessage,
      exchIdx: number,
      isActExch: boolean,
      exchangeModelId: string,
    ) => {
      const chatId = activeChatIdRef.current ?? activeChatId
      if (!chatId || isActiveLoading) return
      const turnId = getUserTurnId(userMsg)
      if (!turnId) return
      if (!isActExch) return

      posthog.capture('chat_response_retry_clicked', {
        exchange_index: exchIdx,
        mode: 'act',
      })

      const runtime = ensureConversationRuntime(chatId)
      shouldScrollRef.current = true

      runtime.askChats[0].stop()
      runtime.actChat.stop()

      const meta = userMsg.metadata as ChatMessageMetadata | undefined
      const indexedFileNames = meta?.indexedDocuments ?? []
      const indexedAttachments = meta?.indexedAttachments ?? []
      const partsForModel =
        userMsg.parts?.filter((part) => part.type === 'text' || part.type === 'file') ?? []
      const replyExtra =
        meta?.replyToTurnId && meta?.replySnippet
          ? String(meta.replySnippet).slice(0, 16000)
          : undefined

      runtime.actChat.messages = stripAssistantAfterUserTurn(runtime.actChat.messages, turnId)
      runtime.askChats[0].messages = stripAssistantAfterUserTurn(runtime.askChats[0].messages, turnId)
      const modelId = normalizeChatModelSelection({
        askModelIds: [exchangeModelId || selectedActModel],
        actModelId: exchangeModelId || selectedActModel,
      }).actModelId
      const msgCountBeforeSend = runtime.askChats[0].messages.length
      startSession(chatId, 'act', activeChatTitle ?? '', msgCountBeforeSend)

      const baseBody = {
        conversationId: chatId,
        turnId,
        mode,
        automationMode: mode === 'automate',
        ...(mode === 'automate' && automationIdParam ? { automationId: automationIdParam } : {}),
        ...(indexedFileNames.length > 0 ? { indexedFileNames, indexedAttachments } : {}),
        ...(replyExtra ? { replyContextForModel: replyExtra } : {}),
      }

      startActRetryStream({
        chatId,
        targetRuntime: runtime,
        textModelsForTurn: [modelId],
        selectedActModel: modelId,
        turnId,
        partsForModel: partsForModel as Array<{ type: string; text?: string; url?: string; mediaType?: string; fileName?: string }>,
        userMetadata: meta,
        commonBody: baseBody,
        isChatActive: (id) => activeChatIdRef.current === id,
        completeSession,
        loadChats,
        loadSubscription,
        onError: (error, fallbackMessage) => reportTextStreamError(error, fallbackMessage),
        logPrefix: 'Act retry',
      })
    },
    [
      activeChatId,
      activeChatIdRef,
      activeChatTitle,
      automationIdParam,
      completeSession,
      ensureConversationRuntime,
      isActiveLoading,
      loadChats,
      loadSubscription,
      mode,
      selectedActModel,
      shouldScrollRef,
      startSession,
    ],
  )

  return {
    handleRetryExchange,
  }
}
