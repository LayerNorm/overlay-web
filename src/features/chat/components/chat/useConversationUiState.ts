'use client'

import {
  useCallback,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from 'react'
import {
  cloneConversationUiState,
  cloneGenerationResultsMap,
  createConversationUiState,
} from '@overlay/chat-core'
import { normalizeChatModelSelection } from '@/shared/chat/chat-model-prefs'
import type {
  ConversationRuntime,
  ConversationUiState,
  GenerationResult,
} from '../chat-interface/types'

type SourcesPanelSetter = (panel: null) => void

export type UseConversationUiStateParams = {
  activeChatId: string | null
  activeChatIdRef: MutableRefObject<string | null>
  applyDefaultChatModelsToView: (ui: Partial<ConversationUiState>) => ConversationUiState
  clearTransientComposerState: () => void
  ensureConversationRuntime: (chatId: string) => ConversationRuntime
  lastGeneratedImageUrlRef: MutableRefObject<string | null>
  pendingTitleRef: MutableRefObject<{ chatId: string; title: string } | null>
  replaceActiveChatRoute: () => void
  resetComposerToolIds: (temporary: boolean) => void
  runtimesRef: MutableRefObject<Map<string, ConversationRuntime>>
  selectedActModel: string
  selectedModels: string[]
  setActiveChatId: Dispatch<SetStateAction<string | null>>
  setActiveViewer: (chatId: string | null) => void
  setAskModelSelectionMode: (mode: 'single' | 'multiple') => void
  setInterruptedExchangeIdx: Dispatch<SetStateAction<number | null>>
  setIsTemporaryChat: Dispatch<SetStateAction<boolean>>
  setSelectedActModel: (modelId: string) => void
  setSelectedModels: (modelIds: string[]) => void
  setSourcesPanel: SourcesPanelSetter
}

export function useConversationUiState({
  activeChatId,
  activeChatIdRef,
  applyDefaultChatModelsToView,
  clearTransientComposerState,
  ensureConversationRuntime,
  lastGeneratedImageUrlRef,
  pendingTitleRef,
  replaceActiveChatRoute,
  resetComposerToolIds,
  runtimesRef,
  selectedActModel,
  selectedModels,
  setActiveChatId,
  setActiveViewer,
  setAskModelSelectionMode,
  setInterruptedExchangeIdx,
  setIsTemporaryChat,
  setSelectedActModel,
  setSelectedModels,
  setSourcesPanel,
}: UseConversationUiStateParams) {
  const [exchangeModes, setExchangeModes] = useState<('ask' | 'act')[]>([])
  const [exchangeModels, setExchangeModels] = useState<string[][]>([])
  const [selectedTabPerExchange, setSelectedTabPerExchange] = useState<number[]>([])
  const [activeChatTitle, setActiveChatTitle] = useState<string | null>(null)
  const [generationResults, setGenerationResults] = useState<Map<number, GenerationResult[]>>(new Map())
  const [exchangeGenTypes, setExchangeGenTypes] = useState<('text' | 'image' | 'video')[]>([])
  const [isFirstMessage, setIsFirstMessage] = useState(true)

  const applyUiStateToView = useCallback((ui: ConversationUiState) => {
    const normalizedTextModels = normalizeChatModelSelection({
      askModelIds: ui.selectedModels,
      actModelId: ui.selectedActModel,
    })
    setSelectedActModel(normalizedTextModels.actModelId)
    setSelectedModels([...normalizedTextModels.askModelIds])
    setAskModelSelectionMode(normalizedTextModels.askModelIds.length > 1 ? 'multiple' : 'single')
    setExchangeModes([...ui.exchangeModes])
    setExchangeModels(ui.exchangeModels.map((models) => [...models]))
    setSelectedTabPerExchange([...ui.selectedTabPerExchange])
    setActiveChatTitle(ui.activeChatTitle)
    setGenerationResults(cloneGenerationResultsMap(ui.generationResults))
    setExchangeGenTypes([...ui.exchangeGenTypes])
    setIsFirstMessage(ui.isFirstMessage)
    lastGeneratedImageUrlRef.current = ui.lastGeneratedImageUrl
  }, [
    lastGeneratedImageUrlRef,
    setAskModelSelectionMode,
    setSelectedActModel,
    setSelectedModels,
  ])

  const buildActiveUiStateSnapshot = useCallback((): ConversationUiState => {
    const activeRuntime = activeChatId ? ensureConversationRuntime(activeChatId) : null
    const normalizedTextModels = normalizeChatModelSelection({
      askModelIds: selectedModels,
      actModelId: selectedActModel,
    })
    return createConversationUiState({
      selectedActModel: normalizedTextModels.actModelId,
      selectedModels: normalizedTextModels.askModelIds,
      askModelSelectionMode: normalizedTextModels.askModelIds.length > 1 ? 'multiple' : 'single',
      exchangeModes,
      exchangeModels,
      selectedTabPerExchange,
      activeChatTitle,
      generationResults,
      exchangeGenTypes,
      isFirstMessage,
      orphanModelThreads: activeRuntime?.ui.orphanModelThreads,
      lastGeneratedImageUrl: lastGeneratedImageUrlRef.current,
    })
  }, [
    activeChatId,
    activeChatTitle,
    ensureConversationRuntime,
    exchangeGenTypes,
    exchangeModels,
    exchangeModes,
    generationResults,
    isFirstMessage,
    lastGeneratedImageUrlRef,
    selectedActModel,
    selectedModels,
    selectedTabPerExchange,
  ])

  const persistActiveRuntimeUiState = useCallback(() => {
    if (!activeChatId) return
    const runtime = ensureConversationRuntime(activeChatId)
    if (!runtime.hydrated) return
    runtime.ui = buildActiveUiStateSnapshot()
  }, [activeChatId, buildActiveUiStateSnapshot, ensureConversationRuntime])

  const updateRuntimeUiState = useCallback((
    chatId: string,
    updater: (prev: ConversationUiState) => ConversationUiState,
  ) => {
    const runtime = ensureConversationRuntime(chatId)
    runtime.ui = updater(cloneConversationUiState(runtime.ui))
    if (activeChatIdRef.current === chatId) {
      applyUiStateToView(runtime.ui)
    }
  }, [activeChatIdRef, applyUiStateToView, ensureConversationRuntime])

  const resetActiveChatAfterDelete = useCallback((chatId: string) => {
    runtimesRef.current.delete(chatId)
    if (activeChatIdRef.current !== chatId) return

    activeChatIdRef.current = null
    pendingTitleRef.current = null
    setIsTemporaryChat(false)
    resetComposerToolIds(false)
    setActiveChatId(null)
    setActiveChatTitle(null)
    setInterruptedExchangeIdx(null)
    setSourcesPanel(null)
    applyUiStateToView(applyDefaultChatModelsToView({
      activeChatTitle: null,
      isFirstMessage: true,
    }))
    clearTransientComposerState()
    setActiveViewer(null)
    replaceActiveChatRoute()
  }, [
    activeChatIdRef,
    applyDefaultChatModelsToView,
    applyUiStateToView,
    clearTransientComposerState,
    pendingTitleRef,
    replaceActiveChatRoute,
    resetComposerToolIds,
    runtimesRef,
    setActiveChatId,
    setActiveViewer,
    setInterruptedExchangeIdx,
    setIsTemporaryChat,
    setSourcesPanel,
  ])

  return {
    activeChatTitle,
    applyUiStateToView,
    buildActiveUiStateSnapshot,
    exchangeGenTypes,
    exchangeModels,
    exchangeModes,
    generationResults,
    isFirstMessage,
    persistActiveRuntimeUiState,
    resetActiveChatAfterDelete,
    selectedTabPerExchange,
    setActiveChatTitle,
    setExchangeGenTypes,
    setExchangeModels,
    setExchangeModes,
    setGenerationResults,
    setIsFirstMessage,
    setSelectedTabPerExchange,
    updateRuntimeUiState,
  }
}
