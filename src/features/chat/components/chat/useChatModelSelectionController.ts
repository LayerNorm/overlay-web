'use client'

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from 'react'
import type { ReasoningLevel } from '@overlay/chat-core'
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
import { subscribeTourModelPicker } from '@/shared/onboarding/tour-model-picker'
import { readableModelId } from './chat-runtime-helpers'
import { safeSetLocalStorage } from './model-selection-utils'
import {
  CHAT_GEN_MODE_KEY,
  IMAGE_MODEL_KEY,
  VIDEO_MODEL_KEY,
  VIDEO_SUB_MODE_KEY,
} from '../chat-interface/constants'

type GatewayModel = {
  id: string
  gatewayId?: string
  name?: string
}

function useModelPickerState() {
  const [showModelPicker, setShowModelPickerState] = useState(false)
  const [showVideoSubModePicker, setShowVideoSubModePicker] = useState(false)
  const [hoveredModelId, setHoveredModelId] = useState<string | null>(null)
  const [modelQualitiesPos, setModelQualitiesPos] = useState<{ x: number; y: number } | null>(null)
  const modelPickerRef = useRef<HTMLDivElement>(null)
  const videoSubModePickerRef = useRef<HTMLDivElement>(null)
  const modelPickerListScrollRef = useRef<HTMLDivElement>(null)
  const tourPickerWantedRef = useRef(false)

  useEffect(() => {
    if (showModelPicker) void import('@overlay/chat-react/model-qualities-panel')
  }, [showModelPicker])

  // While the onboarding tour holds the picker open, closes are ignored — the
  // tour's own Next click is an outside pointer-down on the popover and would
  // otherwise dismiss it between steps.
  const setShowModelPicker = useCallback<Dispatch<SetStateAction<boolean>>>(
    (value) => {
      setShowModelPickerState((prev) => {
        const next = typeof value === 'function' ? value(prev) : value
        return !next && tourPickerWantedRef.current ? prev : next
      })
    },
    [],
  )

  // The onboarding tour keeps the picker open while its steps anchor to
  // elements inside the open panel (e.g. the generation-mode toggle).
  useEffect(
    () =>
      subscribeTourModelPicker((open) => {
        tourPickerWantedRef.current = open
        setShowModelPickerState(open)
      }),
    [],
  )

  useEffect(() => {
    if (!showModelPicker) {
      setHoveredModelId(null)
      setModelQualitiesPos(null)
      return
    }
  }, [showModelPicker])

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

  const onHoveredModelChange = useCallback((modelId: string | null, position: { x: number; y: number } | null) => {
    setHoveredModelId(modelId)
    setModelQualitiesPos(position)
  }, [])

  return {
    hoveredModelId,
    modelPickerListScrollRef,
    modelPickerRef,
    modelQualitiesPos,
    onHoveredModelChange,
    setShowModelPicker,
    setShowVideoSubModePicker,
    showModelPicker,
    showVideoSubModePicker,
    videoSubModePickerRef,
  }
}

function useMediaModelSelection({
  isActiveLoading,
  selectedVideoModels,
  setSelectedImageModels,
  setSelectedVideoModels,
  setShowModelPicker,
  setVideoSubMode,
}: {
  isActiveLoading: boolean
  selectedVideoModels: string[]
  setSelectedImageModels: (modelIds: string[]) => void
  setSelectedVideoModels: (modelIds: string[]) => void
  setShowModelPicker: (value: boolean) => void
  setVideoSubMode: (mode: VideoSubMode) => void
}) {
  const handleVideoSubModeChange = useCallback((subMode: VideoSubMode) => {
    if (isActiveLoading) return
    setVideoSubMode(subMode)
    safeSetLocalStorage(VIDEO_SUB_MODE_KEY, subMode)
    const models = getVideoModelsBySubMode(subMode)
    const first = models[0]?.id
    const selectedVideoModelSet = new Set(selectedVideoModels)
    if (first && !models.some((model) => selectedVideoModelSet.has(model.id))) {
      setSelectedVideoModels([first])
      safeSetLocalStorage(VIDEO_MODEL_KEY, first)
    }
  }, [isActiveLoading, selectedVideoModels, setSelectedVideoModels, setVideoSubMode])

  const selectImageModelInPicker = useCallback((modelId: string) => {
    if (isActiveLoading) return
    const next = [modelId]
    setSelectedImageModels(next)
    safeSetLocalStorage(IMAGE_MODEL_KEY, next[0] ?? '')
    setShowModelPicker(false)
  }, [isActiveLoading, setSelectedImageModels, setShowModelPicker])

  const selectVideoModelInPicker = useCallback((modelId: string) => {
    if (isActiveLoading) return
    const next = [modelId]
    setSelectedVideoModels(next)
    safeSetLocalStorage(VIDEO_MODEL_KEY, next[0] ?? '')
    setShowModelPicker(false)
  }, [isActiveLoading, setSelectedVideoModels, setShowModelPicker])

  return {
    handleVideoSubModeChange,
    selectImageModelInPicker,
    selectVideoModelInPicker,
  }
}

function useTextModelSelection({
  activeChatId,
  chatPrefsHydrated,
  isTemporaryChat,
  selectedActModel,
  selectedModels,
  setSelectedActModel,
  setSelectedModels,
  setShowModelPicker,
  updateSettings,
  userAskModelOverrideRef,
}: {
  activeChatId: string | null
  chatPrefsHydrated: boolean
  isTemporaryChat: boolean
  selectedActModel: string
  selectedModels: string[]
  setSelectedActModel: (modelId: string) => void
  setSelectedModels: (modelIds: string[]) => void
  setShowModelPicker: (value: boolean) => void
  updateSettings: (settings: { defaultAskModelIds: string[]; defaultActModelId: string }) => void
  userAskModelOverrideRef: MutableRefObject<boolean>
}) {
  const isOnNewChatSurface = !activeChatId && !isTemporaryChat
  const persistNewChatModel = useCallback((id: string) => {
    if (!isOnNewChatSurface) return
    const normalized = normalizeChatModelSelection({ askModelIds: [id], actModelId: id })
    void updateSettings({
      defaultAskModelIds: normalized.askModelIds,
      defaultActModelId: normalized.actModelId,
    })
  }, [isOnNewChatSurface, updateSettings])

  useEffect(() => {
    if (!chatPrefsHydrated) return
    const selectedModel = selectedModels[0] ?? selectedActModel
    const normalized = normalizeChatModelSelection({
      askModelIds: [selectedModel],
      actModelId: selectedActModel,
    })
    const selectionChanged =
      normalized.actModelId !== selectedActModel ||
      normalized.askModelIds.length !== selectedModels.length ||
      normalized.askModelIds[0] !== selectedModels[0]

    if (selectionChanged) {
      setSelectedModels(normalized.askModelIds)
      setSelectedActModel(normalized.actModelId)
    }
  }, [
    chatPrefsHydrated,
    selectedActModel,
    selectedModels,
    setSelectedActModel,
    setSelectedModels,
    userAskModelOverrideRef,
  ])

  const toggleTextModelInPicker = useCallback((modelId: string) => {
    userAskModelOverrideRef.current = isOnNewChatSurface
    setSelectedActModel(modelId)
    setSelectedModels([modelId])
    persistNewChatModel(modelId)
    setShowModelPicker(false)
  }, [
    isOnNewChatSurface,
    persistNewChatModel,
    setSelectedActModel,
    setSelectedModels,
    setShowModelPicker,
    userAskModelOverrideRef,
  ])

  return {
    toggleTextModelInPicker,
  }
}

function resolveModelPickerLabel({
  gatewayCatalogModels,
  gatewayModelsLoading,
  generationMode,
  selectedActModel,
  selectedImageModels,
  selectedVideoModels,
}: {
  gatewayCatalogModels: GatewayModel[]
  gatewayModelsLoading: boolean
  generationMode: GenerationMode
  selectedActModel: string
  selectedImageModels: string[]
  selectedVideoModels: string[]
}): string {
  if (generationMode === 'image') {
    return IMAGE_MODELS.find((model) => model.id === selectedImageModels[0])?.name ?? 'Select model'
  }
  if (generationMode === 'video') {
    return VIDEO_MODELS.find((model) => model.id === selectedVideoModels[0])?.name ?? 'Select model'
  }
  const selectedGatewayModelName = gatewayCatalogModels.find(
    (model) => model.id === selectedActModel || model.gatewayId === selectedActModel,
  )?.name
  const registeredModelName = getChatModelDisplayName(selectedActModel)
  const selectedTextModelName =
    selectedGatewayModelName ||
    (registeredModelName !== selectedActModel ? registeredModelName : readableModelId(selectedActModel))
  return selectedTextModelName || (gatewayModelsLoading ? 'Loading models...' : 'Select model')
}

export function useChatModelSelectionController({
  activeChatId,
  chatPrefsHydrated,
  gatewayCatalogModels,
  gatewayModelsLoading,
  generationMode,
  isActiveLoading,
  isFreeTier,
  isTemporaryChat,
  reasoning,
  onReasoningChange,
  selectableTextModels,
  selectedActModel,
  selectedImageModels,
  selectedModels,
  selectedVideoModels,
  setGenerationChip,
  setGenerationMode,
  setSelectedActModel,
  setSelectedImageModels,
  setSelectedModels,
  setSelectedVideoModels,
  setVideoSubMode,
  updateSettings,
  userAskModelOverrideRef,
  videoSubMode,
}: {
  activeChatId: string | null
  chatPrefsHydrated: boolean
  gatewayCatalogModels: GatewayModel[]
  gatewayModelsLoading: boolean
  generationMode: GenerationMode
  isActiveLoading: boolean
  isFreeTier: boolean
  isTemporaryChat: boolean
  reasoning?: ReasoningLevel
  onReasoningChange?: (level: ReasoningLevel | undefined) => void
  selectableTextModels: ChatModel[]
  selectedActModel: string
  selectedImageModels: string[]
  selectedModels: string[]
  selectedVideoModels: string[]
  setGenerationChip: (mode: 'image' | 'video' | null) => void
  setGenerationMode: (mode: GenerationMode | ((prev: GenerationMode) => GenerationMode)) => void
  setSelectedActModel: (modelId: string) => void
  setSelectedImageModels: (modelIds: string[]) => void
  setSelectedModels: (modelIds: string[]) => void
  setSelectedVideoModels: (modelIds: string[]) => void
  setVideoSubMode: (mode: VideoSubMode) => void
  updateSettings: (settings: { defaultAskModelIds: string[]; defaultActModelId: string }) => void
  userAskModelOverrideRef: MutableRefObject<boolean>
  videoSubMode: VideoSubMode
}) {
  const {
    hoveredModelId,
    modelPickerListScrollRef,
    modelPickerRef,
    modelQualitiesPos,
    onHoveredModelChange,
    setShowModelPicker,
    setShowVideoSubModePicker,
    showModelPicker,
    showVideoSubModePicker,
    videoSubModePickerRef,
  } = useModelPickerState()

  const handleModeChange = useCallback((mode: GenerationMode) => {
    setGenerationMode(mode)
    setGenerationChip(null)
    safeSetLocalStorage(CHAT_GEN_MODE_KEY, mode)
  }, [setGenerationChip, setGenerationMode])

  const {
    handleVideoSubModeChange,
    selectImageModelInPicker,
    selectVideoModelInPicker,
  } = useMediaModelSelection({
    isActiveLoading,
    selectedVideoModels,
    setSelectedImageModels,
    setSelectedVideoModels,
    setShowModelPicker,
    setVideoSubMode,
  })

  const { toggleTextModelInPicker } = useTextModelSelection({
    activeChatId,
    chatPrefsHydrated,
    isTemporaryChat,
    selectedActModel,
    selectedModels,
    setSelectedActModel,
    setSelectedModels,
    setShowModelPicker,
    updateSettings,
    userAskModelOverrideRef,
  })

  const modelPickerLabel = resolveModelPickerLabel({
    gatewayCatalogModels,
    gatewayModelsLoading,
    generationMode,
    selectedActModel,
    selectedImageModels,
    selectedVideoModels,
  })

  const headerModelProps = useMemo(() => ({
    getChatModelDisplayName,
    hoveredModelId,
    imageModels: IMAGE_MODELS,
    isFreeTier,
    isFreeTierChatModelId,
    modelPickerLabel,
    modelPickerListScrollRef,
    modelPickerRef,
    modelQualitiesPos,
    reasoning,
    onHoveredModelChange,
    onReasoningChange,
    onSetShowModelPicker: setShowModelPicker,
    onSetShowVideoSubModePicker: setShowVideoSubModePicker,
    onSelectImageModel: selectImageModelInPicker,
    onToggleModelPicker: () => setShowModelPicker((value) => !value),
    onToggleTextModel: toggleTextModelInPicker,
    onSelectVideoModel: selectVideoModelInPicker,
    onToggleVideoSubModePicker: () => setShowVideoSubModePicker((value) => !value),
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
    videoModels: getVideoModelsBySubMode(videoSubMode),
    videoSubMode,
    videoSubModePickerRef,
  }), [
    gatewayModelsLoading,
    handleVideoSubModeChange,
    hoveredModelId,
    isFreeTier,
    modelPickerLabel,
    modelQualitiesPos,
    onHoveredModelChange,
    onReasoningChange,
    reasoning,
    selectableTextModels,
    selectedActModel,
    selectedImageModels,
    selectedModels,
    selectedVideoModels,
    modelPickerListScrollRef,
    modelPickerRef,
    setShowModelPicker,
    setShowVideoSubModePicker,
    showModelPicker,
    showVideoSubModePicker,
    selectImageModelInPicker,
    toggleTextModelInPicker,
    selectVideoModelInPicker,
    videoSubMode,
    videoSubModePickerRef,
  ])

  return {
    handleModeChange,
    headerModelProps,
    setGenerationMode,
    setShowModelPicker,
  }
}
