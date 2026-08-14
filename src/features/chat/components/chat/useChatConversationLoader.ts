'use client'

import { useCallback, useRef } from 'react'
import type { MutableRefObject } from 'react'
import type { UIMessage } from '@/shared/chat/ai-ui-message'
import { DEFAULT_MODEL_ID } from '@/shared/ai/gateway/model-types'
import { normalizeChatModelSelection } from '@/shared/chat/chat-model-prefs'
import { consumeNewEmptyChat, removeCachedChat } from '@/shared/chat/chat-list-cache'
import {
  buildRestoredMessageExchanges,
  cloneUiMessageThread,
  createConversationUiState,
  groupOutputsIntoExchanges,
  restoreGenerationStateForExchanges,
  syntheticMessagesForOutputGroups,
} from '@overlay/chat-core'
import {
  loadConversationSnapshot,
  normalizeReplyMetadata,
  type RawConversationMessage,
} from './chatTransport'
import { clearRuntimeMessages, resetRuntimeState } from './conversation-runtime-utils'
import type { Conversation, ConversationRuntime, ConversationUiState } from '../chat-interface/types'

export interface UseChatConversationLoaderParams {
  activeChatIdRef: MutableRefObject<string | null>
  applyUiStateToView: (ui: ConversationUiState) => void
  chats: Conversation[]
  ensureConversationRuntime: (chatId: string) => ConversationRuntime
  emptyRuntimeRef: MutableRefObject<ConversationRuntime>
  hasAutomationContext: boolean
  isTemporaryChatRef: MutableRefObject<boolean>
  loadGeneratedOutputs: boolean
  markRead: (chatId: string) => void
  pendingTitleRef: MutableRefObject<{ chatId: string; title: string } | null>
  persistActiveRuntimeUiState: () => void
  resetComposerToolIds: (temporary: boolean) => void
  runtimesRef: MutableRefObject<Map<string, ConversationRuntime>>
  selectedActModel: string
  selectedModels: string[]
  setActiveChatId: (chatId: string | null) => void
  setActiveChatTitle: (title: string | null) => void
  setActiveViewer: (chatId: string | null) => void
  setChats: React.Dispatch<React.SetStateAction<Conversation[]>>
  setComposerNotice: (notice: string | null) => void
  setInterruptedExchangeIdx: (idx: number | null) => void
  setIsSwitchingChat: (switching: boolean) => void
  setIsTemporaryChat: (temporary: boolean) => void
  setRuntimeHydrationVersion: React.Dispatch<React.SetStateAction<number>>
  setSourcesPanel: (panel: null) => void
  shouldScrollRef: MutableRefObject<boolean>
  syncStandaloneChatUrl: (chatId: string | null, options?: { replaceUrl?: boolean }) => void
  clearTransientComposerState: () => void
  conversationSnapshots?: Readonly<Record<string, import('./chatTransport').ConversationLoadSnapshot>>
}

export function useChatConversationLoader({
  activeChatIdRef,
  applyUiStateToView,
  chats,
  clearTransientComposerState,
  conversationSnapshots,
  ensureConversationRuntime,
  emptyRuntimeRef,
  hasAutomationContext,
  isTemporaryChatRef,
  loadGeneratedOutputs,
  markRead,
  pendingTitleRef,
  persistActiveRuntimeUiState,
  resetComposerToolIds,
  runtimesRef,
  selectedActModel,
  selectedModels,
  setActiveChatId,
  setActiveChatTitle,
  setActiveViewer,
  setChats,
  setComposerNotice,
  setInterruptedExchangeIdx,
  setIsSwitchingChat,
  setIsTemporaryChat,
  setRuntimeHydrationVersion,
  setSourcesPanel,
  shouldScrollRef,
  syncStandaloneChatUrl,
}: UseChatConversationLoaderParams) {
  const loadChatRequestRef = useRef(0)

  const invalidateLoadChatRequest = useCallback(() => {
    ++loadChatRequestRef.current
  }, [])

  const loadChat = useCallback(async (chatId: string, options: { replaceUrl?: boolean } = {}) => {
    const requestId = ++loadChatRequestRef.current
    persistActiveRuntimeUiState()
    if (isTemporaryChatRef.current) {
      resetRuntimeState(emptyRuntimeRef.current)
    }
    setIsTemporaryChat(false)
    resetComposerToolIds(false)
    clearTransientComposerState()
    setInterruptedExchangeIdx(null)
    setSourcesPanel(null)
    markRead(chatId)
    activeChatIdRef.current = chatId
    setActiveViewer(chatId)
    setActiveChatId(chatId)
    syncStandaloneChatUrl(chatId, options)
    const runtime = ensureConversationRuntime(chatId)
    const existingChat = chats.find((chat) => chat._id === chatId)
    const newEmptyChat = consumeNewEmptyChat(chatId)
    const chatMeta = existingChat ?? newEmptyChat
    setActiveChatTitle(chatMeta?.title ?? runtime.ui.activeChatTitle ?? null)
    pendingTitleRef.current = null

    if (newEmptyChat) {
      const selection = normalizeChatModelSelection({
        askModelIds: newEmptyChat.askModelIds?.slice(0, 4) ?? selectedModels,
        actModelId: newEmptyChat.actModelId ?? selectedActModel,
      })
      runtime.ui = createConversationUiState({
        activeChatTitle: newEmptyChat.title,
        askModelSelectionMode: selection.askModelIds.length > 1 ? 'multiple' : 'single',
        isFirstMessage: true,
        selectedActModel: selection.actModelId,
        selectedModels: selection.askModelIds,
      })
      runtime.hydrated = true
      applyUiStateToView(runtime.ui)
      setRuntimeHydrationVersion((value) => value + 1)
      return
    }

    const runtimeHasLoadedHistory =
      runtime.actChat.messages.some((message) => message.role === 'user') ||
      runtime.askChats.some((chat) => chat.messages.some((message) => message.role === 'user')) ||
      runtime.ui.generationResults.size > 0
    if (runtime.hydrated && runtimeHasLoadedHistory) {
      shouldScrollRef.current = true
      applyUiStateToView(runtime.ui)
      setRuntimeHydrationVersion((value) => value + 1)
      return
    }

    setIsSwitchingChat(true)
    runtime.hydrated = false
    try {
      const shouldLoadMeta = !chatMeta?.title || !chatMeta?.askModelIds?.length || !chatMeta?.actModelId
      const snapshot = conversationSnapshots?.[chatId] ?? await loadConversationSnapshot({
        chatId,
        loadGeneratedOutputs,
        shouldLoadMeta,
      })
      if (requestId !== loadChatRequestRef.current) return
      if (snapshot.status === 'missing') {
        removeCachedChat(chatId)
        setChats((prev) => prev.filter((chat) => chat._id !== chatId))
        runtimesRef.current.delete(chatId)
        if (activeChatIdRef.current === chatId) {
          activeChatIdRef.current = null
          setActiveChatId(null)
          setActiveChatTitle(null)
          setActiveViewer(null)
          syncStandaloneChatUrl(null, options)
        }
        setComposerNotice('That chat no longer exists.')
        window.setTimeout(() => setComposerNotice(null), 4000)
        return
      }
      if (snapshot.status === 'error') {
        clearRuntimeMessages(runtime)
        runtime.hydrated = false
        setComposerNotice('Could not load chat messages. Try again.')
        window.setTimeout(() => setComposerNotice(null), 5000)
        return
      }
      let rawMessages: RawConversationMessage[] = normalizeReplyMetadata(snapshot.messages)
      const outputs = snapshot.outputs
      if (requestId !== loadChatRequestRef.current) return
      const outputGroups = groupOutputsIntoExchanges(outputs)

      if (rawMessages.length === 0 && outputGroups.length > 0) {
        rawMessages = syntheticMessagesForOutputGroups<RawConversationMessage>(outputGroups)
      }

      const hasUserMessages = rawMessages.some((msg) => msg.role === 'user')
      let resolvedTitle = chatMeta?.title ?? null
      let restoredTextSelection = normalizeChatModelSelection({
        askModelIds: chatMeta?.askModelIds?.slice(0, 4) ?? selectedModels,
        actModelId: chatMeta?.actModelId ?? selectedActModel,
      })
      if (snapshot.meta) {
        const meta = snapshot.meta
        if (requestId !== loadChatRequestRef.current) return
        if (meta.title) resolvedTitle = meta.title
        if (meta.askModelIds?.length || meta.actModelId) {
          restoredTextSelection = normalizeChatModelSelection({
            askModelIds: meta.askModelIds?.length ? meta.askModelIds.slice(0, 4) : restoredTextSelection.askModelIds,
            actModelId: meta.actModelId ?? restoredTextSelection.actModelId,
          })
        }
      }
      let resolvedSelectedModels = restoredTextSelection.askModelIds
      let resolvedActModel = restoredTextSelection.actModelId

      if (requestId !== loadChatRequestRef.current) return

      const exchanges = buildRestoredMessageExchanges(rawMessages, {
        defaultModelId: DEFAULT_MODEL_ID,
        hasAutomationContext,
      })

      const exchangeModesFromServer = exchanges.map((e) => e.mode)
      const uniqueModels: string[] = []
      for (const ex of exchanges) {
        for (const { model } of ex.responses) {
          if (!uniqueModels.includes(model)) uniqueModels.push(model)
        }
      }

      if (requestId !== loadChatRequestRef.current) return

      clearRuntimeMessages(runtime)
      const restoredModelThreads = new Map<string, UIMessage[]>()

      if (uniqueModels.length === 0) {
        const linear: RawConversationMessage[] = []
        for (const ex of exchanges) {
          linear.push(ex.userMsg)
          for (const r of ex.responses) linear.push(r.msg)
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        runtime.askChats[0].messages = linear as any
      } else {
        const slotModels = uniqueModels.slice(0, 4)
        const normalizedSlotSelection = normalizeChatModelSelection({
          askModelIds: slotModels,
          actModelId: resolvedActModel,
        })
        resolvedSelectedModels = normalizedSlotSelection.askModelIds
        resolvedActModel = normalizedSlotSelection.actModelId

        uniqueModels.forEach((modelId) => {
          const msgs: RawConversationMessage[] = []
          for (const ex of exchanges) {
            msgs.push(ex.userMsg)
            const r = ex.responses.find((x) => x.model === modelId)
            if (r) msgs.push(r.msg)
          }
          restoredModelThreads.set(modelId, cloneUiMessageThread(msgs as unknown as UIMessage[]))
        })

        slotModels.forEach((modelId, slotIdx) => {
          const msgs = restoredModelThreads.get(modelId) ?? []
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          runtime.askChats[slotIdx].messages = msgs as any
        })
      }

      const actLinear: RawConversationMessage[] = []
      for (const ex of exchanges) {
        if (ex.mode !== 'act') continue
        actLinear.push(ex.userMsg)
        if (ex.responses[0]) actLinear.push(ex.responses[0].msg)
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      runtime.actChat.messages = actLinear as any

      const {
        exchangeGenTypes: restoredGenTypes,
        generationResults: restoredResults,
        exchangeModels: restoredExchangeModels,
      } = restoreGenerationStateForExchanges(exchanges, outputGroups)

      runtime.ui = createConversationUiState({
        selectedActModel: resolvedActModel,
        selectedModels: resolvedSelectedModels,
        askModelSelectionMode: resolvedSelectedModels.length > 1 ? 'multiple' : 'single',
        exchangeModes: exchangeModesFromServer,
        exchangeModels: restoredExchangeModels,
        selectedTabPerExchange: exchanges.map(() => 0),
        activeChatTitle: resolvedTitle,
        generationResults: restoredResults,
        exchangeGenTypes: restoredGenTypes,
        isFirstMessage: !hasUserMessages,
        orphanModelThreads: restoredModelThreads,
      })
      if (requestId !== loadChatRequestRef.current) return
      runtime.hydrated = true
      shouldScrollRef.current = true
      applyUiStateToView(runtime.ui)
      setRuntimeHydrationVersion((value) => value + 1)
    } catch {
      clearRuntimeMessages(runtime)
      runtime.hydrated = false
      setComposerNotice('Could not load this chat. Try again.')
      window.setTimeout(() => setComposerNotice(null), 5000)
    } finally {
      if (requestId === loadChatRequestRef.current) setIsSwitchingChat(false)
    }
  }, [
    activeChatIdRef,
    applyUiStateToView,
    chats,
    clearTransientComposerState,
    conversationSnapshots,
    ensureConversationRuntime,
    emptyRuntimeRef,
    hasAutomationContext,
    isTemporaryChatRef,
    loadGeneratedOutputs,
    markRead,
    pendingTitleRef,
    persistActiveRuntimeUiState,
    resetComposerToolIds,
    runtimesRef,
    selectedActModel,
    selectedModels,
    setActiveChatId,
    setActiveChatTitle,
    setActiveViewer,
    setChats,
    setComposerNotice,
    setInterruptedExchangeIdx,
    setIsSwitchingChat,
    setIsTemporaryChat,
    setRuntimeHydrationVersion,
    setSourcesPanel,
    shouldScrollRef,
    syncStandaloneChatUrl,
  ])

  return {
    invalidateLoadChatRequest,
    loadChat,
    loadChatRequestRef,
  }
}
