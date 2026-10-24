'use client'

import {
  useCallback,
  useLayoutEffect,
  useRef,
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
import { withViewModelSelection } from './chat-runtime-helpers'
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
  setInterruptedExchangeIdx,
  setIsTemporaryChat,
  setSelectedActModel,
  setSelectedModels,
  setSourcesPanel,
}: UseConversationUiStateParams) {
  const [exchangeModes, setExchangeModes] = useState<('ask' | 'act')[]>([])
  const [exchangeModels, setExchangeModels] = useState<string[][]>([])
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
    setExchangeModes([...ui.exchangeModes])
    setExchangeModels(ui.exchangeModels.map((models) => models.slice(0, 1)))
    setActiveChatTitle(ui.activeChatTitle)
    setGenerationResults(cloneGenerationResultsMap(ui.generationResults))
    setExchangeGenTypes([...ui.exchangeGenTypes])
    setIsFirstMessage(ui.isFirstMessage)
    lastGeneratedImageUrlRef.current = ui.lastGeneratedImageUrl
  }, [
    lastGeneratedImageUrlRef,
    setSelectedActModel,
    setSelectedModels,
  ])

  const buildActiveUiStateSnapshot = useCallback((): ConversationUiState => {
    const normalizedTextModels = normalizeChatModelSelection({
      askModelIds: selectedModels,
      actModelId: selectedActModel,
    })
    return createConversationUiState({
      selectedActModel: normalizedTextModels.actModelId,
      selectedModels: normalizedTextModels.askModelIds,
      exchangeModes,
      exchangeModels,
      activeChatTitle,
      generationResults,
      exchangeGenTypes,
      isFirstMessage,
      lastGeneratedImageUrl: lastGeneratedImageUrlRef.current,
    })
  }, [
    activeChatId,
    activeChatTitle,
    exchangeGenTypes,
    exchangeModels,
    exchangeModes,
    generationResults,
    isFirstMessage,
    lastGeneratedImageUrlRef,
    selectedActModel,
    selectedModels,
  ])

  const viewModelSelectionRef = useRef({ selectedModels, selectedActModel })
  useLayoutEffect(() => {
    viewModelSelectionRef.current = { selectedModels, selectedActModel }
  }, [selectedModels, selectedActModel])

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
    const isActive = activeChatIdRef.current === chatId
    const base = cloneConversationUiState(runtime.ui)
    runtime.ui = updater(isActive ? withViewModelSelection(base, viewModelSelectionRef.current) : base)
    if (isActive) {
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
    setActiveChatTitle,
    setExchangeGenTypes,
    setExchangeModels,
    setExchangeModes,
    setGenerationResults,
    setIsFirstMessage,
    updateRuntimeUiState,
  }
}
