'use client'

import {
  useCallback,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
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
  setComposerNotice,
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
  setComposerNotice: Dispatch<SetStateAction<string | null>>
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
      exchModelList: string[],
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

      runtime.askChats.forEach((chat) => chat.stop())
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

      const normalizedRetrySelection = normalizeChatModelSelection({
        askModelIds: exchModelList.length > 0 ? exchModelList : [selectedActModel],
        actModelId: exchModelList[0] ?? selectedActModel,
      })
      const retryModelIds = normalizedRetrySelection.askModelIds
      const multiRetry = retryModelIds.length > 1
      const retrySlots = Math.min(4, retryModelIds.length)
      if (multiRetry) {
        for (let slot = 0; slot < retrySlots; slot += 1) {
          runtime.askChats[slot].messages = stripAssistantAfterUserTurn(
            runtime.askChats[slot].messages,
            turnId,
          )
        }
        runtime.actChat.messages = stripAssistantAfterUserTurn(runtime.actChat.messages, turnId)
      } else {
        runtime.actChat.messages = stripAssistantAfterUserTurn(runtime.actChat.messages, turnId)
        runtime.askChats[0].messages = stripAssistantAfterUserTurn(runtime.askChats[0].messages, turnId)
      }
      const modelId = normalizedRetrySelection.actModelId
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
        textModelsForTurn: multiRetry ? retryModelIds.slice(0, retrySlots) : [modelId],
        textSlotCount: retrySlots,
        selectedActModel: modelId,
        turnId,
        partsForModel: partsForModel as Array<{ type: string; text?: string; url?: string; mediaType?: string; fileName?: string }>,
        userMetadata: meta,
        commonBody: baseBody,
        isChatActive: (id) => activeChatIdRef.current === id,
        completeSession,
        loadChats,
        loadSubscription,
        onError: (error, fallbackMessage) => reportTextStreamError(setComposerNotice, error, fallbackMessage),
        logPrefix: multiRetry ? 'Act multi retry' : 'Act retry',
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
      setComposerNotice,
      shouldScrollRef,
      startSession,
    ],
  )

  return {
    handleRetryExchange,
  }
}
