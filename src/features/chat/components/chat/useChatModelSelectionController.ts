'use client'

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type MutableRefObject } from 'react'
import {
  cloneOrphanModelThreadsMap,
  cloneUiMessageThread,
  createConversationUiState,
  sameModelOrder,
} from '@overlay/chat-core'
import type { UIMessage } from '@/shared/chat/ai-ui-message'
import {
  isFreeTierChatModelId,
  type GenerationMode,
  type VideoSubMode,
  type ChatModel,
} from '@/shared/ai/gateway/model-types'
import {
  IMAGE_MODELS,
  VIDEO_MODELS,
  getChatModelDisplayName,
  getModel,
  getVideoModelsBySubMode,
} from '@/shared/ai/gateway/model-data'
import { normalizeChatModelSelection } from '@/shared/chat/chat-model-prefs'
import { readableModelId } from './chat-runtime-helpers'
import { safeSetLocalStorage, toggleModelSelection } from './model-selection-utils'
import {
  CHAT_GEN_MODE_KEY,
  IMAGE_MODEL_SELECTION_MODE_KEY,
  SELECTED_IMAGE_MODELS_KEY,
  SELECTED_VIDEO_MODELS_KEY,
  VIDEO_MODEL_SELECTION_MODE_KEY,
  VIDEO_SUB_MODE_KEY,
} from '../chat-interface/constants'
import type {
  AskModelSelectionMode,
  ConversationRuntime,
} from '../chat-interface/types'

type GatewayModel = {
  id: string
  gatewayId?: string
  name?: string
}

export function useChatModelSelectionController({
  activeChatId,
  activeChatIdRef,
  activeRuntime,
  askModelSelectionMode,
  chatPrefsHydrated,
  exchangeGenTypes,
  exchangeModels,
  gatewayCatalogModels,
  gatewayModelsLoading,
  generationMode,
  hasAutomationContext,
  isActiveLoading,
  isFreeTier,
  isTemporaryChat,
  selectableTextModels,
  selectedActModel,
  selectedImageModels,
  selectedModels,
  selectedVideoModels,
  setAskModelSelectionMode,
  setGenerationChip,
  setGenerationMode,
  setImageModelSelectionMode,
  setSelectedActModel,
  setSelectedImageModels,
  setSelectedModels,
  setSelectedVideoModels,
  setVideoModelSelectionMode,
  setVideoSubMode,
  updateSettings,
  userAskModelOverrideRef,
  videoModelSelectionMode,
  videoSubMode,
  imageModelSelectionMode,
}: {
  activeChatId: string | null
  activeChatIdRef: MutableRefObject<string | null>
  activeRuntime: ConversationRuntime
  askModelSelectionMode: AskModelSelectionMode
  chatPrefsHydrated: boolean
  exchangeGenTypes: ('text' | 'image' | 'video')[]
  exchangeModels: string[][]
  gatewayCatalogModels: GatewayModel[]
  gatewayModelsLoading: boolean
  generationMode: GenerationMode
  hasAutomationContext: boolean
  isActiveLoading: boolean
  isFreeTier: boolean
  isTemporaryChat: boolean
  selectableTextModels: ChatModel[]
  selectedActModel: string
  selectedImageModels: string[]
  selectedModels: string[]
  selectedVideoModels: string[]
  setAskModelSelectionMode: (mode: AskModelSelectionMode) => void
  setGenerationChip: (mode: 'image' | 'video' | null) => void
  setGenerationMode: (mode: GenerationMode | ((prev: GenerationMode) => GenerationMode)) => void
  setImageModelSelectionMode: (mode: AskModelSelectionMode) => void
  setSelectedActModel: (modelId: string) => void
  setSelectedImageModels: (modelIds: string[]) => void
  setSelectedModels: (modelIds: string[]) => void
  setSelectedVideoModels: (modelIds: string[]) => void
  setVideoModelSelectionMode: (mode: AskModelSelectionMode) => void
  setVideoSubMode: (mode: VideoSubMode) => void
  updateSettings: (settings: { defaultAskModelIds: string[]; defaultActModelId: string }) => void
  userAskModelOverrideRef: MutableRefObject<boolean>
  videoModelSelectionMode: AskModelSelectionMode
  videoSubMode: VideoSubMode
  imageModelSelectionMode: AskModelSelectionMode
}) {
  const [showModelPicker, setShowModelPicker] = useState(false)
  const [showVideoSubModePicker, setShowVideoSubModePicker] = useState(false)
  const [hoveredModelId, setHoveredModelId] = useState<string | null>(null)
  const [modelQualitiesPos, setModelQualitiesPos] = useState<{ x: number; y: number } | null>(null)
  const modelPickerRef = useRef<HTMLDivElement>(null)
  const videoSubModePickerRef = useRef<HTMLDivElement>(null)
  const modelPickerListScrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (showModelPicker) void import('@overlay/chat-react/model-qualities-panel')
  }, [showModelPicker])

  const syncModelQualitiesPosition = useCallback((modelId: string | null) => {
    if (typeof document === 'undefined' || !modelId || !modelPickerRef.current) {
      setModelQualitiesPos(null)
      return
    }
    const row = modelPickerRef.current.querySelector(`[data-model-row="${CSS.escape(modelId)}"]`)
    if (!row || !(row instanceof HTMLElement)) {
      setModelQualitiesPos(null)
      return
    }
    const rect = row.getBoundingClientRect()
    setModelQualitiesPos({ x: rect.left - 8, y: rect.top + rect.height / 2 })
  }, [])

  useEffect(() => {
    if (!showModelPicker) {
      setHoveredModelId(null)
      setModelQualitiesPos(null)
      return
    }
    function handleOutside(event: MouseEvent) {
      if (modelPickerRef.current && !modelPickerRef.current.contains(event.target as Node)) {
        setShowModelPicker(false)
      }
    }
    function handleEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') setShowModelPicker(false)
    }
    document.addEventListener('mousedown', handleOutside, true)
    document.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('mousedown', handleOutside, true)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [showModelPicker])

  useLayoutEffect(() => {
    if (!showModelPicker || (!hasAutomationContext && generationMode !== 'text') || !hoveredModelId) {
      setModelQualitiesPos(null)
      return
    }
    syncModelQualitiesPosition(hoveredModelId)
  }, [
    generationMode,
    hasAutomationContext,
    hoveredModelId,
    showModelPicker,
    syncModelQualitiesPosition,
  ])

  useEffect(() => {
    const element = modelPickerListScrollRef.current
    if (!element || !showModelPicker || !hoveredModelId) return
    const handleScroll = () => syncModelQualitiesPosition(hoveredModelId)
    element.addEventListener('scroll', handleScroll, { passive: true })
    return () => element.removeEventListener('scroll', handleScroll)
  }, [hoveredModelId, showModelPicker, syncModelQualitiesPosition])

  useEffect(() => {
    if (!showModelPicker || !hoveredModelId) return
    const handleResize = () => syncModelQualitiesPosition(hoveredModelId)
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [hoveredModelId, showModelPicker, syncModelQualitiesPosition])

  useEffect(() => {
    function openPicker() { setShowModelPicker(true) }
    function closePicker() { setShowModelPicker(false) }
    window.addEventListener('overlay:tour:open-model-picker', openPicker)
    window.addEventListener('overlay:tour:close-model-picker', closePicker)
    return () => {
      window.removeEventListener('overlay:tour:open-model-picker', openPicker)
      window.removeEventListener('overlay:tour:close-model-picker', closePicker)
    }
  }, [])

  useEffect(() => {
    if (!showVideoSubModePicker) return
    function handleOutside(event: MouseEvent) {
      if (videoSubModePickerRef.current && !videoSubModePickerRef.current.contains(event.target as Node)) {
        setShowVideoSubModePicker(false)
      }
    }
    function handleEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') setShowVideoSubModePicker(false)
    }
    document.addEventListener('mousedown', handleOutside, true)
    document.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('mousedown', handleOutside, true)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [showVideoSubModePicker])

  const handleModeChange = useCallback((mode: GenerationMode) => {
    setGenerationMode(mode)
    setGenerationChip(null)
    safeSetLocalStorage(CHAT_GEN_MODE_KEY, mode)
  }, [setGenerationChip, setGenerationMode])

  const handleImageModelSelectionModeChange = useCallback((next: AskModelSelectionMode) => {
    if (isActiveLoading || generationMode !== 'image') return
    if (next === imageModelSelectionMode) return
    if (isFreeTier && next === 'multiple') return
    safeSetLocalStorage(IMAGE_MODEL_SELECTION_MODE_KEY, next)
    setImageModelSelectionMode(next)
    if (next === 'single' && selectedImageModels.length > 1) {
      const one = [selectedImageModels[0]!]
      setSelectedImageModels(one)
      safeSetLocalStorage(SELECTED_IMAGE_MODELS_KEY, JSON.stringify(one))
    }
  }, [
    generationMode,
    imageModelSelectionMode,
    isActiveLoading,
    isFreeTier,
    selectedImageModels,
    setImageModelSelectionMode,
    setSelectedImageModels,
  ])

  const handleVideoModelSelectionModeChange = useCallback((next: AskModelSelectionMode) => {
    if (isActiveLoading || generationMode !== 'video') return
    if (next === videoModelSelectionMode) return
    if (isFreeTier && next === 'multiple') return
    safeSetLocalStorage(VIDEO_MODEL_SELECTION_MODE_KEY, next)
    setVideoModelSelectionMode(next)
    if (next === 'single' && selectedVideoModels.length > 1) {
      const one = [selectedVideoModels[0]!]
      setSelectedVideoModels(one)
      safeSetLocalStorage(SELECTED_VIDEO_MODELS_KEY, JSON.stringify(one))
    }
  }, [
    generationMode,
    isActiveLoading,
    isFreeTier,
    selectedVideoModels,
    setSelectedVideoModels,
    setVideoModelSelectionMode,
    videoModelSelectionMode,
  ])

  const handleVideoSubModeChange = useCallback((subMode: VideoSubMode) => {
    if (isActiveLoading) return
    setVideoSubMode(subMode)
    safeSetLocalStorage(VIDEO_SUB_MODE_KEY, subMode)
    const models = getVideoModelsBySubMode(subMode)
    const first = models[0]?.id
    if (first && !models.some((model) => selectedVideoModels.includes(model.id))) {
      setSelectedVideoModels([first])
      safeSetLocalStorage(SELECTED_VIDEO_MODELS_KEY, JSON.stringify([first]))
    }
  }, [isActiveLoading, selectedVideoModels, setSelectedVideoModels, setVideoSubMode])

  const toggleImageModelInPicker = useCallback((modelId: string) => {
    if (isActiveLoading) return
    const next = toggleModelSelection(selectedImageModels, modelId, imageModelSelectionMode)
    if (sameModelOrder(next, selectedImageModels)) return
    setSelectedImageModels(next)
    safeSetLocalStorage(SELECTED_IMAGE_MODELS_KEY, JSON.stringify(next))
    if (imageModelSelectionMode === 'single') setShowModelPicker(false)
  }, [
    imageModelSelectionMode,
    isActiveLoading,
    selectedImageModels,
    setSelectedImageModels,
  ])

  const toggleVideoModelInPicker = useCallback((modelId: string) => {
    if (isActiveLoading) return
    const next = toggleModelSelection(selectedVideoModels, modelId, videoModelSelectionMode)
    if (sameModelOrder(next, selectedVideoModels)) return
    setSelectedVideoModels(next)
    safeSetLocalStorage(SELECTED_VIDEO_MODELS_KEY, JSON.stringify(next))
    if (videoModelSelectionMode === 'single') setShowModelPicker(false)
  }, [
    isActiveLoading,
    selectedVideoModels,
    setSelectedVideoModels,
    videoModelSelectionMode,
  ])

  const isOnNewChatSurface = !activeChatId && !isTemporaryChat
  const persistNewChatAskModels = useCallback((ids: string[]) => {
    if (!isOnNewChatSurface) return
    const normalized = normalizeChatModelSelection({ askModelIds: ids })
    void updateSettings({
      defaultAskModelIds: normalized.askModelIds,
      defaultActModelId: normalized.actModelId,
    })
  }, [isOnNewChatSurface, updateSettings])

  const persistNewChatActModel = useCallback((id: string) => {
    if (!isOnNewChatSurface) return
    const normalized = normalizeChatModelSelection({ askModelIds: selectedModels, actModelId: id })
    void updateSettings({
      defaultAskModelIds: normalized.askModelIds,
      defaultActModelId: normalized.actModelId,
    })
  }, [isOnNewChatSurface, selectedModels, updateSettings])

  useEffect(() => {
    if (!chatPrefsHydrated) return
    if (
      userAskModelOverrideRef.current &&
      askModelSelectionMode === 'single' &&
      selectedModels.length === 1 &&
      selectedModels[0] === selectedActModel
    ) {
      return
    }
    const normalized = normalizeChatModelSelection({
      askModelIds:
        askModelSelectionMode === 'single'
          ? [selectedActModel]
          : selectedModels,
      actModelId: selectedActModel,
    })
    const resolvedAskIds =
      askModelSelectionMode === 'single'
        ? [normalized.actModelId]
        : normalized.askModelIds
    const selectionChanged =
      normalized.actModelId !== selectedActModel ||
      !sameModelOrder(resolvedAskIds, selectedModels)

    if (selectionChanged) {
      setSelectedModels(resolvedAskIds)
      setSelectedActModel(normalized.actModelId)
      if (askModelSelectionMode === 'multiple') {
        setAskModelSelectionMode(resolvedAskIds.length > 1 ? 'multiple' : 'single')
      }
    }
  }, [
    askModelSelectionMode,
    chatPrefsHydrated,
    selectedActModel,
    selectedModels,
    setAskModelSelectionMode,
    setSelectedActModel,
    setSelectedModels,
    userAskModelOverrideRef,
  ])

  const snapshotCurrentAskThreadsForModelPicker = useCallback(() => {
    if (!activeChatIdRef.current && !isTemporaryChat) return
    const latestTextIdx = (() => {
      for (let index = exchangeModels.length - 1; index >= 0; index -= 1) {
        if ((exchangeGenTypes[index] ?? 'text') === 'text') return index
      }
      return -1
    })()
    const threadModelOrder =
      latestTextIdx >= 0 && exchangeModels[latestTextIdx]?.length
        ? exchangeModels[latestTextIdx]!
        : selectedModels
    const nextOrphans = cloneOrphanModelThreadsMap(activeRuntime.ui.orphanModelThreads)
    threadModelOrder.slice(0, 4).forEach((modelId, slotIdx) => {
      const messages = activeRuntime.askChats[slotIdx]?.messages as UIMessage[] | undefined
      if (messages?.length) {
        nextOrphans.set(modelId, cloneUiMessageThread(messages))
      }
    })
    activeRuntime.ui = createConversationUiState({
      ...activeRuntime.ui,
      orphanModelThreads: nextOrphans,
    })
  }, [
    activeChatIdRef,
    activeRuntime,
    exchangeGenTypes,
    exchangeModels,
    isTemporaryChat,
    selectedModels,
  ])

  const handleTextModelSelectionModeChange = useCallback((next: AskModelSelectionMode) => {
    if (generationMode !== 'text') return
    if (next === askModelSelectionMode) return
    if (isFreeTier && next === 'multiple') return
    if (hasAutomationContext && next === 'multiple') return
    userAskModelOverrideRef.current = true
    snapshotCurrentAskThreadsForModelPicker()
    setAskModelSelectionMode(next)
    if (next === 'single' && selectedModels.length > 1) {
      const one = [selectedModels[0]!]
      setSelectedModels(one)
      setSelectedActModel(one[0]!)
      persistNewChatAskModels(one)
      persistNewChatActModel(one[0]!)
    } else if (next === 'multiple' && selectedModels.length > 0) {
      setSelectedActModel(selectedModels[0]!)
      persistNewChatActModel(selectedModels[0]!)
    }
  }, [
    askModelSelectionMode,
    generationMode,
    hasAutomationContext,
    isFreeTier,
    persistNewChatActModel,
    persistNewChatAskModels,
    selectedModels,
    setAskModelSelectionMode,
    setSelectedActModel,
    setSelectedModels,
    snapshotCurrentAskThreadsForModelPicker,
    userAskModelOverrideRef,
  ])

  const toggleTextModelInPicker = useCallback((modelId: string) => {
    if (isOnNewChatSurface) {
      userAskModelOverrideRef.current = true
    }
    snapshotCurrentAskThreadsForModelPicker()
    if (askModelSelectionMode === 'single') {
      const next = toggleModelSelection(selectedModels, modelId, askModelSelectionMode)
      if (sameModelOrder(next, selectedModels) && selectedActModel === modelId) return
      setSelectedActModel(modelId)
      setSelectedModels(next)
      persistNewChatActModel(modelId)
      persistNewChatAskModels(next)
      setShowModelPicker(false)
      return
    }
    const next = toggleModelSelection(selectedModels, modelId, askModelSelectionMode)
    if (sameModelOrder(next, selectedModels)) return
    setSelectedModels(next)
    if (!next.includes(selectedActModel)) {
      setSelectedActModel(next[0]!)
      persistNewChatActModel(next[0]!)
    } else if (next.length === 1) {
      setSelectedActModel(modelId)
      persistNewChatActModel(modelId)
    }
    persistNewChatAskModels(next)
  }, [
    askModelSelectionMode,
    isOnNewChatSurface,
    persistNewChatActModel,
    persistNewChatAskModels,
    selectedActModel,
    selectedModels,
    setSelectedActModel,
    setSelectedModels,
    snapshotCurrentAskThreadsForModelPicker,
    userAskModelOverrideRef,
  ])

  const selectedGatewayModelName = gatewayCatalogModels.find(
    (model) => model.id === selectedActModel || model.gatewayId === selectedActModel,
  )?.name
  const registeredModelName = getChatModelDisplayName(selectedActModel)
  const selectedTextModelName =
    selectedGatewayModelName ||
    (registeredModelName !== selectedActModel ? registeredModelName : readableModelId(selectedActModel))
  const modelPickerLabel = generationMode === 'image'
    ? (selectedImageModels.length === 1 ? (IMAGE_MODELS.find((model) => model.id === selectedImageModels[0])?.name ?? 'Select model') : `${selectedImageModels.length} models`)
    : generationMode === 'video'
      ? (selectedVideoModels.length === 1 ? (VIDEO_MODELS.find((model) => model.id === selectedVideoModels[0])?.name ?? 'Select model') : `${selectedVideoModels.length} models`)
      : (askModelSelectionMode === 'multiple' && selectedModels.length > 1
          ? `${selectedModels.length} models`
          : (selectedTextModelName || (gatewayModelsLoading ? 'Loading models...' : 'Select model')))

  const onHoveredModelChange = useCallback((modelId: string | null, position: { x: number; y: number } | null) => {
    setHoveredModelId(modelId)
    setModelQualitiesPos(position)
  }, [])

  const headerModelProps = useMemo(() => ({
    askModelSelectionMode,
    getChatModelDisplayName,
    hasAutomationContext,
    hoveredModelId,
    imageModelSelectionMode,
    imageModels: IMAGE_MODELS,
    isFreeTier,
    isFreeTierChatModelId,
    modelPickerLabel,
    modelPickerListScrollRef,
    modelPickerRef,
    modelQualitiesPos,
    onHoveredModelChange,
    onImageModelSelectionModeChange: handleImageModelSelectionModeChange,
    onSetShowModelPicker: setShowModelPicker,
    onSetShowVideoSubModePicker: setShowVideoSubModePicker,
    onTextModelSelectionModeChange: handleTextModelSelectionModeChange,
    onToggleImageModel: toggleImageModelInPicker,
    onToggleModelPicker: () => setShowModelPicker((value) => !value),
    onToggleTextModel: toggleTextModelInPicker,
    onToggleVideoModel: toggleVideoModelInPicker,
    onToggleVideoSubModePicker: () => setShowVideoSubModePicker((value) => !value),
    onVideoModelSelectionModeChange: handleVideoModelSelectionModeChange,
    onVideoSubModeChange: handleVideoSubModeChange,
    resolveModel: getModel,
    selectableTextModels,
    selectedActModel,
    selectedImageModels,
    selectedModels,
    selectedVideoModels,
    showModelPicker,
    showVideoSubModePicker,
    textModelsLoading: gatewayModelsLoading,
    videoModelSelectionMode,
    videoModels: getVideoModelsBySubMode(videoSubMode),
    videoSubMode,
    videoSubModePickerRef,
  }), [
    askModelSelectionMode,
    gatewayModelsLoading,
    handleImageModelSelectionModeChange,
    handleTextModelSelectionModeChange,
    handleVideoModelSelectionModeChange,
    handleVideoSubModeChange,
    hasAutomationContext,
    hoveredModelId,
    imageModelSelectionMode,
    isFreeTier,
    modelPickerLabel,
    modelQualitiesPos,
    onHoveredModelChange,
    selectableTextModels,
    selectedActModel,
    selectedImageModels,
    selectedModels,
    selectedVideoModels,
    showModelPicker,
    showVideoSubModePicker,
    toggleImageModelInPicker,
    toggleTextModelInPicker,
    toggleVideoModelInPicker,
    videoModelSelectionMode,
    videoSubMode,
  ])

  return {
    handleModeChange,
    headerModelProps,
    snapshotCurrentAskThreadsForModelPicker,
    setGenerationMode,
    setShowModelPicker,
  }
}
