'use client'

import { useCallback, useEffect, useRef, type MutableRefObject } from 'react'
import { toast } from '@overlay/ui/primitives'
import type { UIMessage } from '@/shared/chat/ai-ui-message'
import { overlayAppClient } from '@/shared/app/overlay-app-client'
import type {
  ConversationRuntime,
} from '../chat-interface/types'

type ChatView = {
  messages: UIMessage[]
  setMessages: (messages: UIMessage[]) => void
  status?: string
  stop: () => void
}

type RuntimeChatView = {
  messages: UIMessage[]
  status?: string
  stop: () => void
}

export function useChatStopController({
  activeAskChats,
  activeChatId,
  activeChatIdRef,
  actChat,
  chat0,
  forceLiveSyncRender,
  getActiveRuntime,
  isActiveLoading,
  onSend,
  primaryMessages,
  replaceConversationRuntime,
  runtimesRef,
  setInput,
  setInterruptedExchangeIdx,
}: {
  activeAskChats: RuntimeChatView[]
  activeChatId: string | null
  activeChatIdRef: MutableRefObject<string | null>
  actChat: ChatView
  chat0: ChatView
  forceLiveSyncRender: () => void
  getActiveRuntime: () => ConversationRuntime
  isActiveLoading: boolean
  onSend: () => void | Promise<void>
  primaryMessages: UIMessage[]
  replaceConversationRuntime: (
    chatId: string,
    uiSnapshot: ConversationRuntime['ui'],
    askMessages: UIMessage[][],
    actMessages: UIMessage[],
  ) => ConversationRuntime
  runtimesRef: MutableRefObject<Map<string, ConversationRuntime>>
  setInput: (value: string) => void
  setInterruptedExchangeIdx: (idx: number | null) => void
}) {
  const stopActiveChat = useCallback(async () => {
    if (!isActiveLoading) return
    const runtime = getActiveRuntime()
    const userTurns = primaryMessages.filter((message) => message.role === 'user').length
    const idx = userTurns > 0 ? userTurns - 1 : -1
    const chatId = activeChatIdRef.current ?? activeChatId
    activeAskChats.forEach((chat) => chat.stop())
    runtime.actChat.stop()

    if (chatId) {
      try {
        const response = await Promise.race([
          overlayAppClient.conversations.stopResponse({ conversationId: chatId }),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('timeout')), 5000),
          ),
        ])
        if (!response.ok) throw new Error('Stop request was rejected.')
      } catch {
        toast.error('Could not confirm that the response stopped. It may still be running.')
      }
    }

    chat0.setMessages([...runtime.askChats[0].messages] as UIMessage[])
    actChat.setMessages([...runtime.actChat.messages] as UIMessage[])

    if (idx >= 0) setInterruptedExchangeIdx(idx)
    forceLiveSyncRender()

    if (!chatId) return
    setTimeout(() => {
      const runtime = runtimesRef.current.get(chatId)
      if (!runtime) return
      const stillLoading =
        runtime.askChats[0].status === 'streaming' ||
        runtime.askChats[0].status === 'submitted' ||
        runtime.actChat.status === 'streaming' ||
        runtime.actChat.status === 'submitted'
      if (stillLoading) {
        const uiSnapshot = { ...runtime.ui }
        const oldAskMessages = [[...runtime.askChats[0].messages]] as UIMessage[][]
        const oldActMessages = [...runtime.actChat.messages]
        replaceConversationRuntime(chatId, uiSnapshot, oldAskMessages, oldActMessages as UIMessage[])
        forceLiveSyncRender()
      }
    }, 400)
  }, [
    activeAskChats,
    activeChatId,
    activeChatIdRef,
    actChat,
    chat0,
    forceLiveSyncRender,
    getActiveRuntime,
    isActiveLoading,
    primaryMessages,
    replaceConversationRuntime,
    runtimesRef,
    setInterruptedExchangeIdx,
  ])

  const stopActiveChatRef = useRef(stopActiveChat)
  useEffect(() => {
    stopActiveChatRef.current = stopActiveChat
  }, [stopActiveChat])

  function handleContinue() {
    setInput('continue')
    void onSend()
  }

  return {
    handleContinue,
    stopActiveChat,
  }
}
