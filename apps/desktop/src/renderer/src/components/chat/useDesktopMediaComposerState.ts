import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ImageModel, VideoModel } from '@overlay/app-core'
import type { AskModelSelectionMode, GenerationMode, VideoSubMode } from '@overlay/chat-core'
import {
  CHAT_GEN_MODE_KEY,
  IMAGE_MODEL_SELECTION_MODE_KEY,
  SELECTED_IMAGE_MODELS_KEY,
  SELECTED_VIDEO_MODELS_KEY,
  VIDEO_MODEL_SELECTION_MODE_KEY,
  VIDEO_SUB_MODE_KEY
} from '@overlay/chat-core'

const MAX_MEDIA_MODELS = 4

interface DesktopMediaComposerStateOptions {
  imageModels: readonly ImageModel[]
  videoModels: readonly VideoModel[]
  defaultImageModelId?: string
  defaultVideoModelId?: string
  isFreeTier: boolean
  persist?: boolean
}

export interface DesktopMediaComposerState {
  generationMode: GenerationMode
  setGenerationMode: (mode: GenerationMode) => void
  selectedImageModelIds: string[]
  selectedVideoModelIds: string[]
  imageModelSelectionMode: AskModelSelectionMode
  videoModelSelectionMode: AskModelSelectionMode
  setImageModelSelectionMode: (mode: AskModelSelectionMode) => void
  setVideoModelSelectionMode: (mode: AskModelSelectionMode) => void
  toggleImageModel: (modelId: string) => void
  toggleVideoModel: (modelId: string) => void
  videoSubMode: VideoSubMode
  setVideoSubMode: (mode: VideoSubMode) => void
}

interface DesktopMediaSubmissionCandidate {
  generationMode: GenerationMode
  prompt: string
  attachmentCount: number
  selectedImageModelIds: readonly string[]
  selectedVideoModelIds: readonly string[]
  videoSubMode: VideoSubMode
}

export function useDesktopMediaComposerState({
  imageModels,
  videoModels,
  defaultImageModelId,
  defaultVideoModelId,
  isFreeTier,
  persist = true
}: DesktopMediaComposerStateOptions): DesktopMediaComposerState {
  const [generationModeState, setGenerationModeState] = useState<GenerationMode>(() =>
    persist ? readGenerationMode() : 'text'
  )
  const [selectedImageModelIds, setSelectedImageModelIds] = useState<string[]>(() =>
    persist ? readModelIds(SELECTED_IMAGE_MODELS_KEY) : []
  )
  const [selectedVideoModelIds, setSelectedVideoModelIds] = useState<string[]>(() =>
    persist ? readModelIds(SELECTED_VIDEO_MODELS_KEY) : []
  )
  const [imageModelSelectionModeState, setImageModelSelectionModeState] =
    useState<AskModelSelectionMode>(() =>
      persist ? readSelectionMode(IMAGE_MODEL_SELECTION_MODE_KEY) : 'single'
    )
  const [videoModelSelectionModeState, setVideoModelSelectionModeState] =
    useState<AskModelSelectionMode>(() =>
      persist ? readSelectionMode(VIDEO_MODEL_SELECTION_MODE_KEY) : 'single'
    )
  const [videoSubModeState, setVideoSubModeState] = useState<VideoSubMode>(() =>
    persist ? readVideoSubMode() : 'text-to-video'
  )

  const imageModelIds = useMemo(() => imageModels.map((model) => model.id), [imageModels])
  const videoModelIds = useMemo(() => videoModels.map((model) => model.id), [videoModels])
  const imageModelSelectionMode = isFreeTier ? 'single' : imageModelSelectionModeState
  const videoModelSelectionMode = isFreeTier ? 'single' : videoModelSelectionModeState

  useEffect(() => {
    setSelectedImageModelIds((current) =>
      reconcileMediaModelSelection(
        current,
        imageModelIds,
        defaultImageModelId,
        imageModelSelectionMode
      )
    )
  }, [defaultImageModelId, imageModelIds, imageModelSelectionMode])

  useEffect(() => {
    setSelectedVideoModelIds((current) =>
      reconcileMediaModelSelection(
        current,
        videoModelIds,
        defaultVideoModelId,
        videoModelSelectionMode
      )
    )
  }, [defaultVideoModelId, videoModelIds, videoModelSelectionMode])

  useEffect(() => {
    if (!persist || !imageModelIds.length || !selectedImageModelIds.length) return
    safeSetLocalStorage(SELECTED_IMAGE_MODELS_KEY, JSON.stringify(selectedImageModelIds))
  }, [imageModelIds.length, persist, selectedImageModelIds])

  useEffect(() => {
    if (!persist || !videoModelIds.length || !selectedVideoModelIds.length) return
    safeSetLocalStorage(SELECTED_VIDEO_MODELS_KEY, JSON.stringify(selectedVideoModelIds))
  }, [persist, selectedVideoModelIds, videoModelIds.length])

  const setGenerationMode = useCallback(
    (mode: GenerationMode) => {
      setGenerationModeState(mode)
      if (persist) safeSetLocalStorage(CHAT_GEN_MODE_KEY, mode)
    },
    [persist]
  )

  const setImageModelSelectionMode = useCallback(
    (mode: AskModelSelectionMode) => {
      if (isFreeTier && mode === 'multiple') return
      setImageModelSelectionModeState(mode)
      if (mode === 'single') setSelectedImageModelIds((current) => current.slice(0, 1))
      if (persist) safeSetLocalStorage(IMAGE_MODEL_SELECTION_MODE_KEY, mode)
    },
    [isFreeTier, persist]
  )

  const setVideoModelSelectionMode = useCallback(
    (mode: AskModelSelectionMode) => {
      if (isFreeTier && mode === 'multiple') return
      setVideoModelSelectionModeState(mode)
      if (mode === 'single') setSelectedVideoModelIds((current) => current.slice(0, 1))
      if (persist) safeSetLocalStorage(VIDEO_MODEL_SELECTION_MODE_KEY, mode)
    },
    [isFreeTier, persist]
  )

  const toggleImageModel = useCallback(
    (modelId: string) => {
      if (!imageModelIds.includes(modelId)) return
      setSelectedImageModelIds((current) =>
        toggleMediaModelSelection(current, modelId, imageModelSelectionMode)
      )
    },
    [imageModelIds, imageModelSelectionMode]
  )

  const toggleVideoModel = useCallback(
    (modelId: string) => {
      if (!videoModelIds.includes(modelId)) return
      setSelectedVideoModelIds((current) =>
        toggleMediaModelSelection(current, modelId, videoModelSelectionMode)
      )
    },
    [videoModelIds, videoModelSelectionMode]
  )

  const setVideoSubMode = useCallback(
    (mode: VideoSubMode) => {
      setVideoSubModeState(mode)
      if (persist) safeSetLocalStorage(VIDEO_SUB_MODE_KEY, mode)
    },
    [persist]
  )

  return {
    generationMode: generationModeState,
    setGenerationMode,
    selectedImageModelIds,
    selectedVideoModelIds,
    imageModelSelectionMode,
    videoModelSelectionMode,
    setImageModelSelectionMode,
    setVideoModelSelectionMode,
    toggleImageModel,
    toggleVideoModel,
    videoSubMode: videoSubModeState,
    setVideoSubMode
  }
}

export function toggleMediaModelSelection(
  current: readonly string[],
  modelId: string,
  mode: AskModelSelectionMode
): string[] {
  if (mode === 'single') return [modelId]
  if (current.includes(modelId)) {
    return current.length > 1 ? current.filter((id) => id !== modelId) : [...current]
  }
  return current.length >= MAX_MEDIA_MODELS ? [...current] : [...current, modelId]
}

export function reconcileMediaModelSelection(
  current: readonly string[],
  availableIds: readonly string[],
  defaultId: string | undefined,
  mode: AskModelSelectionMode
): string[] {
  if (!availableIds.length) return []
  const available = new Set(availableIds)
  const valid = current.filter((id, index) => available.has(id) && current.indexOf(id) === index)
  const fallback = defaultId && available.has(defaultId) ? defaultId : availableIds[0]
  const next = valid.length ? valid.slice(0, MAX_MEDIA_MODELS) : fallback ? [fallback] : []
  return mode === 'single' ? next.slice(0, 1) : next
}

export function canSubmitDesktopMediaDraft({
  generationMode,
  prompt,
  attachmentCount,
  selectedImageModelIds,
  selectedVideoModelIds,
  videoSubMode
}: DesktopMediaSubmissionCandidate): boolean {
  if (generationMode === 'text') return Boolean(prompt.trim()) || attachmentCount > 0
  if (!prompt.trim()) return false
  if (generationMode === 'image') return selectedImageModelIds.length > 0
  return (
    selectedVideoModelIds.length > 0 &&
    (videoSubMode !== 'image-to-video' || attachmentCount > 0)
  )
}

function readGenerationMode(): GenerationMode {
  const value = safeGetLocalStorage(CHAT_GEN_MODE_KEY)
  return value === 'image' || value === 'video' || value === 'text' ? value : 'text'
}

function readSelectionMode(key: string): AskModelSelectionMode {
  return safeGetLocalStorage(key) === 'multiple' ? 'multiple' : 'single'
}

function readVideoSubMode(): VideoSubMode {
  const value = safeGetLocalStorage(VIDEO_SUB_MODE_KEY)
  return value === 'image-to-video' ? value : 'text-to-video'
}

function readModelIds(key: string): string[] {
  try {
    const parsed = JSON.parse(safeGetLocalStorage(key) ?? '[]') as unknown
    return Array.isArray(parsed)
      ? parsed.filter((id): id is string => typeof id === 'string').slice(0, MAX_MEDIA_MODELS)
      : []
  } catch {
    return []
  }
}

function safeGetLocalStorage(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function safeSetLocalStorage(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    // Blocked storage must not break the composer.
  }
}
