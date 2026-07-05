'use client'

import { useCallback, useEffect, useRef, type MutableRefObject } from 'react'
import type { UIMessage } from '@/shared/chat/ai-ui-message'
import { overlayAppClient } from '@/shared/app/overlay-app-client'
import type {
  ConversationRuntime,
  LiveConversationMessage,
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
  chat1,
  chat2,
  chat3,
  chatStreamRelayApi,
  forceLiveSyncRender,
  getActiveRuntime,
  isActiveLoading,
  lastStreamChunkAtRef,
  liveMessages,
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
  chat1: ChatView
  chat2: ChatView
  chat3: ChatView
  chatStreamRelayApi: string | null | undefined
  forceLiveSyncRender: () => void
  getActiveRuntime: () => ConversationRuntime
  isActiveLoading: boolean
  lastStreamChunkAtRef: MutableRefObject<number>
  liveMessages: LiveConversationMessage[] | undefined
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
    const cloudflareStopTargets = new Map<string, { turnId: string; variantIndex: number }>()
    const collectCloudflareStopTargets = (messages: UIMessage[]) => {
      for (const message of messages) {
        const m = message as unknown as {
          role?: string
          status?: string
          turnId?: string
          id?: string
          variantIndex?: number
        }
        if (m.role === 'assistant' && m.status === 'generating' && m.turnId?.trim()) {
          const variantIndex = m.variantIndex ?? 0
          cloudflareStopTargets.set(`${m.turnId}:${variantIndex}`, {
            turnId: m.turnId,
            variantIndex,
          })
        }
      }
    }
    collectCloudflareStopTargets(runtime.actChat.messages as UIMessage[])
    for (const chat of runtime.askChats) {
      collectCloudflareStopTargets(chat.messages as UIMessage[])
    }
    if (cloudflareStopTargets.size === 0) {
      const lastUser = [...primaryMessages].reverse().find((message) => message.role === 'user') as
        | (UIMessage & { id?: string })
        | undefined
      const turnId = lastUser?.id?.trim()
      if (turnId) {
        cloudflareStopTargets.set(`${turnId}:0`, { turnId, variantIndex: 0 })
      }
    }

    activeAskChats.forEach((chat) => chat.stop())
    runtime.actChat.stop()

    if (chatId) {
      if (chatStreamRelayApi && cloudflareStopTargets.size > 0) {
        await Promise.allSettled([...cloudflareStopTargets.values()].map((target) =>
          fetch(`${chatStreamRelayApi}/stop`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify({
              conversationId: chatId,
              turnId: target.turnId,
              variantIndex: target.variantIndex,
              multiModelSlotIndex: target.variantIndex,
            }),
          }),
        ))
      }
      try {
        await Promise.race([
          overlayAppClient.conversations.stopResponse({ conversationId: chatId }),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('timeout')), 5000),
          ),
        ])
      } catch {
        // Backend call failed or timed out; local cleanup still makes the UI usable.
      }
    }

    const completeGeneratingMessages = (messages: UIMessage[]) => {
      let changed = false
      const nextMessages = messages.map((message) => {
        const m = message as unknown as { role?: string; status?: string }
        if (m.role === 'assistant' && m.status === 'generating') {
          changed = true
          return { ...message, status: 'completed' } as UIMessage
        }
        return message
      })
      return { changed, messages: changed ? nextMessages : messages }
    }

    for (const chat of runtime.askChats) {
      const patch = completeGeneratingMessages(chat.messages as UIMessage[])
      if (patch.changed) {
        chat.messages = patch.messages as never
      }
    }
    const actPatch = completeGeneratingMessages(runtime.actChat.messages as UIMessage[])
    if (actPatch.changed) {
      runtime.actChat.messages = actPatch.messages as never
    }

    chat0.setMessages([...runtime.askChats[0].messages] as UIMessage[])
    if (activeAskChats[1]) chat1.setMessages([...runtime.askChats[1].messages] as UIMessage[])
    if (activeAskChats[2]) chat2.setMessages([...runtime.askChats[2].messages] as UIMessage[])
    if (activeAskChats[3]) chat3.setMessages([...runtime.askChats[3].messages] as UIMessage[])
    actChat.setMessages([...runtime.actChat.messages] as UIMessage[])

    if (idx >= 0) setInterruptedExchangeIdx(idx)
    forceLiveSyncRender()

    if (!chatId) return
    setTimeout(() => {
      const runtime = runtimesRef.current.get(chatId)
      if (!runtime) return
      const stillLoading =
        runtime.askChats.some((chat) => chat.status === 'streaming' || chat.status === 'submitted') ||
        runtime.actChat.status === 'streaming' ||
        runtime.actChat.status === 'submitted'
      if (stillLoading) {
        const uiSnapshot = { ...runtime.ui }
        const oldAskMessages = runtime.askChats.map((chat) => [...chat.messages])
        const oldActMessages = [...runtime.actChat.messages]
        replaceConversationRuntime(chatId, uiSnapshot, oldAskMessages as UIMessage[][], oldActMessages as UIMessage[])
        forceLiveSyncRender()
      }
    }, 400)
  }, [
    activeAskChats,
    activeChatId,
    activeChatIdRef,
    actChat,
    chat0,
    chat1,
    chat2,
    chat3,
    chatStreamRelayApi,
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

  useEffect(() => {
    if (!activeChatId) return
    const id = setInterval(() => {
      const runtime = runtimesRef.current.get(activeChatId)
      if (!runtime) return
      const hasLocalStream =
        runtime.askChats.some((chat) => chat.status === 'streaming' || chat.status === 'submitted') ||
        runtime.actChat.status === 'streaming' ||
        runtime.actChat.status === 'submitted'
      if (hasLocalStream) {
        lastStreamChunkAtRef.current = Date.now()
        return
      }
      const hasPersistedGenerating = (liveMessages ?? []).some(
        (message) => message.role === 'assistant' && message.status === 'generating',
      )
      if (!hasPersistedGenerating) return
      if (Date.now() - lastStreamChunkAtRef.current > 30000) {
        stopActiveChatRef.current()
      }
    }, 5000)
    return () => clearInterval(id)
  }, [activeChatId, lastStreamChunkAtRef, liveMessages, runtimesRef])

  return {
    handleContinue,
    stopActiveChat,
  }
}
