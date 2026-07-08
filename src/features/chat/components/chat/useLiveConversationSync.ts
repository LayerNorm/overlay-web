'use client'

import { useEffect, useRef, type MutableRefObject } from 'react'
import type { UIMessage } from '@/shared/chat/ai-ui-message'
import { useQuery } from '@/components/providers/convex-hooks'
import { overlayAppClient } from '@/shared/app/overlay-app-client'
import { api } from '../../../../../convex/_generated/api'
import type { Id } from '../../../../../convex/_generated/dataModel'
import type {
  ConversationRuntime,
  LiveConversationMessage,
  LiveMessageDelta,
} from '../chat-interface/types'
import { shouldResumeChatStreamIntoAskSlot } from './chatStreamResume'
import {
  applyLiveDeltasToRuntime,
  cloneRuntimeMessageArrays,
  getLiveGeneratingAssistantMessages,
  hasGeneratingRuntimeMessage,
  liveMessagesHaveGeneratingAssistant,
  patchLiveMessagesIntoRuntime,
  patchServerAssistantRowsIntoRuntime,
  type ServerAssistantMessageRow,
} from './live-message-patching'

type ChatView = {
  messages: UIMessage[]
  setMessages: (messages: UIMessage[]) => void
  status?: string
  error?: Error | null
  resumeStream: (options: { body: Record<string, unknown> }) => Promise<unknown>
}

type AsyncSession = {
  status?: string
}

type UseLiveConversationSyncParams = {
  activeChatId: string | null
  activeChatIdRef: MutableRefObject<string | null>
  activeRuntime: ConversationRuntime
  actChat: ChatView
  authUserId: string | null | undefined
  chatInstances: ChatView[]
  chatStreamRelayApi: string | null | undefined
  completeSession: (chatId: string, isActive: boolean) => void
  convexAccessToken: string | null | undefined
  enableConvexLiveSync: boolean
  lastStreamChunkAtRef: MutableRefObject<number>
  loadChats: () => Promise<void>
  onRuntimeMessagesChanged: () => void
  runtimeHydrationVersion: number
  runtimesRef: MutableRefObject<Map<string, ConversationRuntime>>
  sessions: Record<string, AsyncSession | undefined>
}

function hasStreamingChat(chat: ChatView) {
  return chat.status === 'streaming' || chat.status === 'submitted'
}

function hasActiveLocalHttpStream({
  activeChatId,
  activeChatIdRef,
  actChat,
  chatInstances,
}: {
  activeChatId: string
  activeChatIdRef: MutableRefObject<string | null>
  actChat: ChatView
  chatInstances: ChatView[]
}) {
  return (
    activeChatIdRef.current === activeChatId &&
    (
      hasStreamingChat(actChat) ||
      chatInstances.some(hasStreamingChat)
    )
  )
}

function syncRuntimeMessagesToChatViews({
  runtime,
  actChat,
  chatInstances,
}: {
  runtime: ConversationRuntime
  actChat: ChatView
  chatInstances: ChatView[]
}) {
  actChat.setMessages([...runtime.actChat.messages] as UIMessage[])
  for (let index = 0; index < chatInstances.length; index += 1) {
    chatInstances[index]?.setMessages([...runtime.askChats[index]!.messages] as UIMessage[])
  }
}

function collectResumeTargets({
  liveMessages,
  runtime,
}: {
  liveMessages: readonly LiveConversationMessage[] | undefined
  runtime: ConversationRuntime
}) {
  const targets = new Map<string, { turnId: string; variantIndex: number }>()
  const collect = (messages: UIMessage[]) => {
    for (const message of messages) {
      const m = message as unknown as {
        role?: string
        status?: string
        turnId?: string
        variantIndex?: number
      }
      if (m.role !== 'assistant' || m.status !== 'generating') continue
      const turnId = m.turnId?.trim() || ''
      if (!turnId) continue
      const variantIndex = m.variantIndex ?? 0
      targets.set(`${turnId}:${variantIndex}`, { turnId, variantIndex })
    }
  }

  for (const message of liveMessages ?? []) {
    if (message.role !== 'assistant' || message.status !== 'generating') continue
    const turnId = message.turnId?.trim() || ''
    if (!turnId) continue
    const variantIndex = message.variantIndex ?? 0
    targets.set(`${turnId}:${variantIndex}`, { turnId, variantIndex })
  }
  collect(runtime.actChat.messages as UIMessage[])
  for (const chat of runtime.askChats) collect(chat.messages as UIMessage[])

  return targets
}

export function useLiveConversationSync({
  activeChatId,
  activeChatIdRef,
  activeRuntime,
  actChat,
  authUserId,
  chatInstances,
  chatStreamRelayApi,
  completeSession,
  convexAccessToken,
  enableConvexLiveSync,
  lastStreamChunkAtRef,
  loadChats,
  onRuntimeMessagesChanged,
  runtimeHydrationVersion,
  runtimesRef,
  sessions,
}: UseLiveConversationSyncParams) {
  const liveGeneratingByChatRef = useRef(new Map<string, boolean>())
  const appliedLiveDeltaIdsRef = useRef(new Set<string>())
  const resumedCloudflareStreamsRef = useRef(new Set<string>())

  useEffect(() => {
    appliedLiveDeltaIdsRef.current.clear()
  }, [activeChatId])

  const liveMessages = useQuery(
    api.chat.conversations.watchGeneratingMessages,
    enableConvexLiveSync && activeChatId && authUserId && convexAccessToken
      ? {
          conversationId: activeChatId as Id<'conversations'>,
          userId: authUserId,
          accessToken: convexAccessToken,
        }
      : 'skip',
  ) as Array<LiveConversationMessage> | undefined
  const liveMessageDeltas = useQuery(
    api.chat.conversations.watchGeneratingMessageDeltas,
    enableConvexLiveSync && activeChatId && authUserId && convexAccessToken
      ? {
          conversationId: activeChatId as Id<'conversations'>,
          userId: authUserId,
          accessToken: convexAccessToken,
        }
      : 'skip',
  ) as Array<LiveMessageDelta> | undefined

  const activePersistedGenerating =
    liveMessagesHaveGeneratingAssistant(liveMessages) ||
    hasGeneratingRuntimeMessage(activeRuntime)

  useEffect(() => {
    if (!activeChatId || !chatStreamRelayApi) return
    const hasLocalHttpStream =
      hasStreamingChat(actChat) ||
      chatInstances.some(hasStreamingChat)
    if (hasLocalHttpStream) return

    const targets = collectResumeTargets({
      liveMessages,
      runtime: activeRuntime,
    })

    const activeVariantCountByTurn = new Map<string, number>()
    for (const target of targets.values()) {
      activeVariantCountByTurn.set(
        target.turnId,
        (activeVariantCountByTurn.get(target.turnId) ?? 0) + 1,
      )
    }

    for (const target of targets.values()) {
      const key = `${activeChatId}:${target.turnId}:${target.variantIndex}`
      if (resumedCloudflareStreamsRef.current.has(key)) continue
      const slotChat = chatInstances[target.variantIndex]
      const resumeIntoAskSlot = shouldResumeChatStreamIntoAskSlot({
        runtime: activeRuntime,
        turnId: target.turnId,
        variantIndex: target.variantIndex,
        activeVariantCount: activeVariantCountByTurn.get(target.turnId) ?? 1,
      })
      const targetChat = resumeIntoAskSlot && slotChat ? slotChat : actChat
      console.info('[chat-stream] resume dispatch', {
        conversationId: activeChatId,
        turnId: target.turnId,
        variantIndex: target.variantIndex,
        targetRuntime: resumeIntoAskSlot && slotChat ? 'ask-slot' : 'act',
      })
      resumedCloudflareStreamsRef.current.add(key)
      void (async () => {
        try {
          await targetChat.resumeStream({
            body: {
              conversationId: activeChatId,
              turnId: target.turnId,
              variantIndex: target.variantIndex,
              multiModelSlotIndex: target.variantIndex,
            },
          })
          if (targetChat.status === 'error') {
            console.error('[chat-stream] resume failed', {
              conversationId: activeChatId,
              turnId: target.turnId,
              variantIndex: target.variantIndex,
              targetRuntime: resumeIntoAskSlot && slotChat ? 'ask-slot' : 'act',
              reason: targetChat.error?.message ?? 'Chat runtime entered an error state',
            })
            resumedCloudflareStreamsRef.current.delete(key)
          }
        } catch (error) {
          console.error('[chat-stream] resume failed', {
            conversationId: activeChatId,
            turnId: target.turnId,
            variantIndex: target.variantIndex,
            targetRuntime: resumeIntoAskSlot && slotChat ? 'ask-slot' : 'act',
            reason: error instanceof Error ? error.message : String(error),
          })
          resumedCloudflareStreamsRef.current.delete(key)
        }
      })()
    }
  }, [activeChatId, activeRuntime, actChat, chatInstances, chatStreamRelayApi, liveMessages])

  useEffect(() => {
    if (!activeChatId || !liveMessages) return
    if (hasActiveLocalHttpStream({ activeChatId, activeChatIdRef, actChat, chatInstances })) return

    const liveGeneratingMessages = getLiveGeneratingAssistantMessages(liveMessages)
    const hadGenerating = liveGeneratingByChatRef.current.get(activeChatId) === true
    liveGeneratingByChatRef.current.set(activeChatId, liveGeneratingMessages.length > 0)
    const runtime = runtimesRef.current.get(activeChatId)
    if (!runtime) {
      if (hadGenerating && liveGeneratingMessages.length === 0) {
        completeSession(activeChatId, activeChatIdRef.current === activeChatId)
        void loadChats()
      }
      return
    }

    const changed = patchLiveMessagesIntoRuntime(runtime, liveMessages)
    if (changed) {
      cloneRuntimeMessageArrays(runtime)
      if (activeChatIdRef.current === activeChatId) {
        syncRuntimeMessagesToChatViews({ runtime, actChat, chatInstances })
      }
      onRuntimeMessagesChanged()
    }
    if (hadGenerating && liveGeneratingMessages.length === 0) {
      completeSession(activeChatId, activeChatIdRef.current === activeChatId)
      void loadChats()
    }
  }, [
    activeChatId,
    activeChatIdRef,
    actChat,
    chatInstances,
    completeSession,
    liveMessages,
    loadChats,
    onRuntimeMessagesChanged,
    runtimeHydrationVersion,
    runtimesRef,
  ])

  useEffect(() => {
    if (!activeChatId || !liveMessageDeltas?.length) return
    if (hasActiveLocalHttpStream({ activeChatId, activeChatIdRef, actChat, chatInstances })) return
    const runtime = runtimesRef.current.get(activeChatId)
    if (!runtime) return

    const changed = applyLiveDeltasToRuntime(
      runtime,
      liveMessageDeltas,
      appliedLiveDeltaIdsRef.current,
    )
    if (!changed) return
    cloneRuntimeMessageArrays(runtime)
    if (activeChatIdRef.current === activeChatId) {
      syncRuntimeMessagesToChatViews({ runtime, actChat, chatInstances })
    }
    onRuntimeMessagesChanged()
    lastStreamChunkAtRef.current = Date.now()
  }, [
    activeChatId,
    activeChatIdRef,
    actChat,
    chatInstances,
    lastStreamChunkAtRef,
    liveMessageDeltas,
    onRuntimeMessagesChanged,
    runtimesRef,
  ])

  useEffect(() => {
    if (!activeChatId) return
    if (hasActiveLocalHttpStream({ activeChatId, activeChatIdRef, actChat, chatInstances })) return
    const sessionIsStreaming = sessions[activeChatId]?.status === 'streaming'
    const liveQuerySawGenerating = liveGeneratingByChatRef.current.get(activeChatId) === true
    if (!sessionIsStreaming && !liveQuerySawGenerating && !activePersistedGenerating) return

    let cancelled = false
    const patchFromServer = async () => {
      try {
        const res = await overlayAppClient.conversations.getResponse({
          conversationId: activeChatId,
          messages: true,
        }, {
          credentials: 'same-origin',
          cache: 'no-store',
        })
        if (!res.ok || cancelled || activeChatIdRef.current !== activeChatId) return
        const data = await res.json() as {
          messages?: Array<{
            id: string
            turnId?: string
            role: 'user' | 'assistant'
            mode?: 'ask' | 'act'
            parts?: Array<Record<string, unknown>>
            model?: string
            variantIndex?: number
            routedModelId?: string
            status?: 'generating' | 'completed' | 'error'
          }>
        }
        const runtime = runtimesRef.current.get(activeChatId)
        if (!runtime) return
        const assistantRows = (data.messages ?? []).filter(
          (message): message is ServerAssistantMessageRow => message.role === 'assistant',
        )
        const changed = patchServerAssistantRowsIntoRuntime(runtime, assistantRows)
        if (!changed) return
        cloneRuntimeMessageArrays(runtime)
        syncRuntimeMessagesToChatViews({ runtime, actChat, chatInstances })
        onRuntimeMessagesChanged()
        if (!assistantRows.some((message) => message.status === 'generating')) {
          liveGeneratingByChatRef.current.set(activeChatId, false)
          completeSession(activeChatId, true)
          void loadChats()
        }
      } catch {
        // Ignore transient reconnect failures; the next tick or Convex subscription can recover.
      }
    }

    void patchFromServer()
    const interval = window.setInterval(() => {
      void patchFromServer()
    }, 5000)
    return () => {
      cancelled = true
      window.clearInterval(interval)
    }
  }, [
    activeChatId,
    activeChatIdRef,
    actChat,
    activePersistedGenerating,
    chatInstances,
    completeSession,
    loadChats,
    onRuntimeMessagesChanged,
    runtimesRef,
    sessions,
  ])

  return {
    activePersistedGenerating,
    liveMessages,
  }
}
