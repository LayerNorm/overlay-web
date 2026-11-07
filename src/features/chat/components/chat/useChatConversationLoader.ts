'use client'

import { useCallback, useRef } from 'react'
import type { MutableRefObject } from 'react'
import { normalizeChatModelSelection } from '@/shared/chat/chat-model-prefs'
import { createConversationUiState } from '@overlay/chat-core'
import { resetRuntimeState } from './conversation-runtime-utils'
import type { ConversationRuntime, ConversationUiState } from '../chat-interface/types'
import type { PersonalChatSummary } from '@/components/providers/PersonalChatProvider'

export interface UseChatConversationLoaderParams {
  activeChatIdRef: MutableRefObject<string | null>
  applyUiStateToView: (ui: ConversationUiState) => void
  clearTransientComposerState: () => void
  ensureConversationRuntime: (chatId: string) => ConversationRuntime
  emptyRuntimeRef: MutableRefObject<ConversationRuntime>
  getNativeSummary: (chatId: string) => PersonalChatSummary | undefined
  isTemporaryChatRef: MutableRefObject<boolean>
  pendingTitleRef: MutableRefObject<{ chatId: string; title: string } | null>
  persistActiveRuntimeUiState: () => void
  resetComposerToolIds: (temporary: boolean) => void
  setActiveChatId: (chatId: string | null) => void
  setActiveChatTitle: (title: string | null) => void
  setActiveViewer: (chatId: string | null) => void
  setInterruptedExchangeIdx: (idx: number | null) => void
  setIsSwitchingChat: (switching: boolean) => void
  setIsTemporaryChat: (temporary: boolean) => void
  setRuntimeHydrationVersion: React.Dispatch<React.SetStateAction<number>>
  setSourcesPanel: (panel: null) => void
  syncStandaloneChatUrl: (chatId: string | null, options?: { replaceUrl?: boolean }) => void
}

/** Selects a chat immediately. Its transcript comes from the Convex subscription. */
export function useChatConversationLoader({
  activeChatIdRef,
  applyUiStateToView,
  clearTransientComposerState,
  ensureConversationRuntime,
  emptyRuntimeRef,
  getNativeSummary,
  isTemporaryChatRef,
  pendingTitleRef,
  persistActiveRuntimeUiState,
  resetComposerToolIds,
  setActiveChatId,
  setActiveChatTitle,
  setActiveViewer,
  setInterruptedExchangeIdx,
  setIsSwitchingChat,
  setIsTemporaryChat,
  setRuntimeHydrationVersion,
  setSourcesPanel,
  syncStandaloneChatUrl,
}: UseChatConversationLoaderParams) {
  const loadChatRequestRef = useRef(0)

  const invalidateLoadChatRequest = useCallback(() => {
    ++loadChatRequestRef.current
  }, [])

  const loadChat = useCallback(async (chatId: string, options: { replaceUrl?: boolean } = {}) => {
    ++loadChatRequestRef.current
    persistActiveRuntimeUiState()
    if (isTemporaryChatRef.current) resetRuntimeState(emptyRuntimeRef.current)
    setIsTemporaryChat(false)
    resetComposerToolIds(false)
    clearTransientComposerState()
    setInterruptedExchangeIdx(null)
    setSourcesPanel(null)
    const summary = getNativeSummary(chatId)
    activeChatIdRef.current = chatId
    setActiveViewer(chatId)
    setActiveChatId(chatId)
    syncStandaloneChatUrl(chatId, options)
    const runtime = ensureConversationRuntime(chatId)
    pendingTitleRef.current = null
    const selection = normalizeChatModelSelection({
      askModelIds: summary?.askModelIds?.slice(0, 4) ?? runtime.ui.selectedModels,
      actModelId: summary?.actModelId ?? runtime.ui.selectedActModel,
    })
    runtime.ui = createConversationUiState({
      ...runtime.ui,
      activeChatTitle: summary?.title ?? null,
      selectedActModel: selection.actModelId,
      selectedModels: selection.askModelIds,
      isFirstMessage: !summary?.lastMessageId,
    })
    runtime.hydrated = false
    setActiveChatTitle(summary?.title ?? null)
    applyUiStateToView(runtime.ui)
    setRuntimeHydrationVersion((value) => value + 1)
    setIsSwitchingChat(false)
  }, [
    activeChatIdRef,
    applyUiStateToView,
    clearTransientComposerState,
    emptyRuntimeRef,
    ensureConversationRuntime,
    getNativeSummary,
    isTemporaryChatRef,
    pendingTitleRef,
    persistActiveRuntimeUiState,
    resetComposerToolIds,
    setActiveChatId,
    setActiveChatTitle,
    setActiveViewer,
    setInterruptedExchangeIdx,
    setIsSwitchingChat,
    setIsTemporaryChat,
    setRuntimeHydrationVersion,
    setSourcesPanel,
    syncStandaloneChatUrl,
  ])

  return { invalidateLoadChatRequest, loadChat, loadChatRequestRef }
}
