'use client'

import { useCallback, useEffect, useRef, type MutableRefObject } from 'react'
import { toast } from '@overlay/ui/primitives'
import type { UIMessage } from '@/shared/chat/ai-ui-message'
import { overlayAppClient } from '@/shared/app/overlay-app-client'
import type {
  ConversationRuntime,
} from '../chat-interface/types'
import { isTerminalAgentRunStatus } from '@/shared/agents/agent-run'
import type { AgentRunResource } from '@overlay/api-client'
import type { NativeRunCommandScope } from './native-personal-lifecycle'
import { nativeRunCommandAllowed } from './native-personal-lifecycle'

type NativeStopScope = NativeRunCommandScope & {
  currentTurnId: string | null
  run: AgentRunResource | null
}

type NativeStopIntent = {
  scopeKey: string
  userId: string
  conversationId: string | null
  turnId: string
}

function nativeStopKey(scope: NativeStopScope, run: AgentRunResource) {
  return JSON.stringify([scope.scopeKey, scope.conversationId, run.id, run.assistantMessageId])
}

export function nativeStopIntentMatches(
  intent: NativeStopIntent | null,
  scope: NativeStopScope,
  run: AgentRunResource | null,
) {
  return Boolean(intent && intent.scopeKey === scope.scopeKey && scope.isCurrentScope()
    && intent.userId === scope.userId
    && (!intent.conversationId || scope.conversationId === intent.conversationId)
    && (!scope.currentTurnId || scope.currentTurnId === intent.turnId)
    && nativeRunCommandAllowed({ scope, run, activeChatId: scope.conversationId })
    && run?.assistantMessageId
    && run.turnId === intent.turnId && run.conversationId === scope.conversationId)
}

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
  nativeScope,
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
  nativeScope?: NativeStopScope
}) {
  const nativeStopIntentRef = useRef<NativeStopIntent | null>(null)
  const nativeStopPendingRef = useRef(new Set<string>())
  const nativeStopCompletedRef = useRef(new Set<string>())

  const stopNativeRun = useCallback(async (scope: NativeStopScope, run: AgentRunResource, turnId: string) => {
    if (!nativeRunCommandAllowed({ scope, run, activeChatId: scope.conversationId })
      || !run.assistantMessageId || run.turnId !== turnId
      || run.conversationId !== scope.conversationId || isTerminalAgentRunStatus(run.status)) return
    const key = nativeStopKey(scope, run)
    if (nativeStopPendingRef.current.has(key) || nativeStopCompletedRef.current.has(key)) return
    nativeStopPendingRef.current.add(key)
    try {
      const response = await overlayAppClient.conversations.stopResponse({
        conversationId: scope.conversationId!,
        messageId: run.assistantMessageId,
      })
      if (response.ok && scope.isCurrentScope()) nativeStopCompletedRef.current.add(key)
      if (!response.ok && scope.isCurrentScope()) {
        toast.error('Could not confirm that the response stopped. It may still be running.')
      }
    } catch {
      if (scope.isCurrentScope()) {
        toast.error('Could not confirm that the response stopped. It may still be running.')
      }
    } finally {
      nativeStopPendingRef.current.delete(key)
    }
  }, [])

  useEffect(() => {
    if (!nativeScope?.enabled) {
      nativeStopIntentRef.current = null
      return
    }
    const currentRun = nativeScope.run
    if (currentRun && isTerminalAgentRunStatus(currentRun.status)) {
      nativeStopCompletedRef.current.delete(nativeStopKey(nativeScope, currentRun))
    }
    const intent = nativeStopIntentRef.current
    if (!intent) return
    if (intent.scopeKey !== nativeScope.scopeKey || !nativeScope.isCurrentScope()) {
      nativeStopIntentRef.current = null
      return
    }
    if (nativeScope.currentTurnId && nativeScope.currentTurnId !== intent.turnId) {
      nativeStopIntentRef.current = null
      return
    }
    const run = nativeScope.run
    if (!run || !nativeStopIntentMatches(intent, nativeScope, run)) return
    nativeStopIntentRef.current = null
    void stopNativeRun(nativeScope, run, intent.turnId)
  }, [
    nativeScope,
    nativeScope?.currentTurnId,
    nativeScope?.run,
    nativeScope?.scopeKey,
    stopNativeRun,
  ])

  const stopActiveChat = useCallback(async () => {
    if (!isActiveLoading) return
    if (nativeScope?.enabled) {
      if (!nativeScope.isCurrentScope()) return
      const runtime = getActiveRuntime()
      activeAskChats.forEach((chat) => chat.stop())
      runtime.actChat.stop()
      forceLiveSyncRender()
      const conversationId = nativeScope.conversationId
      const turnId = nativeScope.currentTurnId
      if (!turnId || !nativeScope.userId || !nativeScope.isCurrentScope()) return
      const run = nativeScope.run
      if (conversationId && run?.turnId === turnId
        && run.conversationId === conversationId && run.assistantMessageId
        && nativeRunCommandAllowed({ scope: nativeScope, run, activeChatId })) {
        await stopNativeRun(nativeScope, run, turnId)
      } else {
        nativeStopIntentRef.current = {
          scopeKey: nativeScope.scopeKey,
          userId: nativeScope.userId!,
          conversationId,
          turnId,
        }
      }
      return
    }
    const runtime = getActiveRuntime()
    const userTurns = primaryMessages.filter((message) => message.role === 'user').length
    const idx = userTurns > 0 ? userTurns - 1 : -1
    const chatId = activeChatIdRef.current ?? activeChatId
    const askMessages = [...runtime.askChats[0].messages] as UIMessage[]
    const actMessages = [...runtime.actChat.messages] as UIMessage[]
    activeAskChats.forEach((chat) => chat.stop())
    runtime.actChat.stop()

    // First-turn activation can reset this runtime while backend cancellation awaits.
    chat0.setMessages(askMessages)
    actChat.setMessages(actMessages)
    if (idx >= 0) setInterruptedExchangeIdx(idx)
    forceLiveSyncRender()

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
    nativeScope,
    primaryMessages,
    replaceConversationRuntime,
    runtimesRef,
    setInterruptedExchangeIdx,
    stopNativeRun,
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
