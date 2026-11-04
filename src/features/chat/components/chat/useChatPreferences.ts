'use client'

import { useCallback, useEffect, useId, useRef, useState } from 'react'
import type { GenerationMode, VideoSubMode } from '@/shared/ai/gateway/model-types'
import type { ReasoningLevel } from '@overlay/chat-core'
import {
  DEFAULT_IMAGE_MODEL_ID,
  DEFAULT_MODEL_ID,
  DEFAULT_VIDEO_MODEL_ID,
} from '@/shared/ai/gateway/model-types'
import { IMAGE_MODELS, VIDEO_MODELS } from '@/shared/ai/gateway/model-data'
import {
  chatReasoningStorageKey,
  isPersistentChatReasoningScope,
  normalizeChatModelSelection,
  readStoredReasoningByModel,
  writeStoredReasoningByModel,
  type ChatReasoningScope,
  type ReasoningByModel,
} from '@/shared/chat/chat-model-prefs'
import { PENDING_FIRST_CHAT_ID } from './chat-send-body-builders'
import { normalizeStoredModelId, safeSetLocalStorage } from './model-selection-utils'
import {
  CHAT_MODEL_KEY,
  ACT_MODEL_KEY,
} from '@/shared/chat/chat-model-prefs'
import {
  CHAT_GEN_MODE_KEY,
  IMAGE_MODEL_KEY,
  VIDEO_MODEL_KEY,
  LEGACY_SELECTED_IMAGE_MODELS_KEY,
  LEGACY_SELECTED_VIDEO_MODELS_KEY,
  VIDEO_SUB_MODE_KEY,
} from '../chat-interface/constants'

export function useChatPreferences({
  activeChatId,
  activeWorkspaceId,
  isTemporaryChat,
}: {
  activeChatId: string | null
  activeWorkspaceId: string | null
  isTemporaryChat: boolean
}) {
  const [selectedActModel, setSelectedActModel] = useState<string>(DEFAULT_MODEL_ID)
  const [selectedModels, setSelectedModels] = useState<string[]>([DEFAULT_MODEL_ID])
  const [chatPrefsHydrated, setChatPrefsHydrated] = useState(false)
  const [hasStoredTextModelSelection, setHasStoredTextModelSelection] = useState(false)
  const [generationMode, setGenerationMode] = useState<GenerationMode>('text')
  const [generationChip, setGenerationChip] = useState<'image' | 'video' | null>(null)
  const [selectedImageModels, setSelectedImageModels] = useState<string[]>([DEFAULT_IMAGE_MODEL_ID])
  const [selectedVideoModels, setSelectedVideoModels] = useState<string[]>([DEFAULT_VIDEO_MODEL_ID])
  const temporaryScopeId = useId()
  const reasoningScope: ChatReasoningScope = isTemporaryChat
    ? { type: 'temporary', id: temporaryScopeId }
    : activeChatId && activeChatId !== PENDING_FIRST_CHAT_ID
      ? { type: 'thread', id: activeChatId }
      : { type: 'workspace', id: activeWorkspaceId ?? 'personal' }
  const reasoningStorageKey = chatReasoningStorageKey(reasoningScope)
  const persistReasoning = isPersistentChatReasoningScope(reasoningScope)
  const [reasoningState, setReasoningState] = useState<{
    storageKey: string
    values: Record<string, ReasoningLevel>
  }>(() => ({ storageKey: '', values: {} }))
  const reasoningByModel: ReasoningByModel = reasoningState.storageKey === reasoningStorageKey
    ? reasoningState.values
    : {}
  const reasoning = reasoningByModel[selectedActModel]
  const [videoSubMode, setVideoSubMode] = useState<VideoSubMode>('text-to-video')
  const lastGeneratedImageUrlRef = useRef<string | null>(null)

  useEffect(() => {
    try {
      const savedMode = localStorage.getItem(CHAT_GEN_MODE_KEY) as GenerationMode | null
      if (savedMode && ['text', 'image', 'video'].includes(savedMode)) setGenerationMode(savedMode)

      const savedVideoSubMode = localStorage.getItem(VIDEO_SUB_MODE_KEY)
      if (savedVideoSubMode) setVideoSubMode(savedVideoSubMode as VideoSubMode)

      // Restore last text chat model selection if present
      try {
        const savedModelsRaw = localStorage.getItem(CHAT_MODEL_KEY)
        const savedAct = localStorage.getItem(ACT_MODEL_KEY)
        if (savedModelsRaw) {
          const parsed = parseStoredModelIds(savedModelsRaw)
          if (parsed.length > 0) {
            const normalized = normalizeChatModelSelection({
              askModelIds: parsed,
              actModelId: savedAct ?? undefined,
            })
            setSelectedModels(normalized.askModelIds)
            setSelectedActModel(normalized.actModelId)
            setHasStoredTextModelSelection(true)
          }
        } else if (savedAct && typeof savedAct === 'string') {
          setSelectedActModel(savedAct)
          setSelectedModels([savedAct])
          setHasStoredTextModelSelection(true)
        }
      } catch {
        /* keep default */
      }

      try {
        const rawImg = localStorage.getItem(IMAGE_MODEL_KEY) ?? localStorage.getItem(LEGACY_SELECTED_IMAGE_MODELS_KEY)
        if (rawImg) {
          const parsed = normalizeStoredModelId(rawImg, IMAGE_MODELS.map((model) => model.id))
          if (parsed) {
            setSelectedImageModels([parsed])
            safeSetLocalStorage(IMAGE_MODEL_KEY, parsed)
          }
        }
      } catch {
        /* keep default */
      }
      try {
        const rawVid = localStorage.getItem(VIDEO_MODEL_KEY) ?? localStorage.getItem(LEGACY_SELECTED_VIDEO_MODELS_KEY)
        if (rawVid) {
          const parsed = normalizeStoredModelId(rawVid, VIDEO_MODELS.map((model) => model.id))
          if (parsed) {
            setSelectedVideoModels([parsed])
            safeSetLocalStorage(VIDEO_MODEL_KEY, parsed)
          }
        }
      } catch {
        /* keep default */
      }
    } catch {
      /* private browsing / blocked storage — keep defaults */
    } finally {
      // Marks prefs hydration complete — this flag is the mechanism itself.
      // react-doctor-disable-next-line react-doctor/no-initialize-state
      setChatPrefsHydrated(true)
    }
  }, [])

  useEffect(() => {
    setReasoningState({
      storageKey: reasoningStorageKey,
      values: persistReasoning ? readStoredReasoningByModel(reasoningStorageKey) : {},
    })
  }, [persistReasoning, reasoningStorageKey])

  const onModelReasoningChange = useCallback((modelId: string, level: ReasoningLevel | undefined) => {
    if (!modelId) return
    const current = reasoningState.storageKey === reasoningStorageKey
      ? reasoningState.values
      : persistReasoning ? readStoredReasoningByModel(reasoningStorageKey) : {}
    const next = { ...current }
    if (!level || level === 'provider-default') delete next[modelId]
    else next[modelId] = level
    if (persistReasoning) writeStoredReasoningByModel(reasoningStorageKey, next)
    setReasoningState({ storageKey: reasoningStorageKey, values: next })
  }, [persistReasoning, reasoningState, reasoningStorageKey])

  const setReasoning = useCallback((level: ReasoningLevel | undefined) => {
    onModelReasoningChange(selectedActModel, level)
  }, [onModelReasoningChange, selectedActModel])

  // Persist text chat model selection to localStorage so it survives
  // navigation and app restarts for the new/personal chat surface.
  useEffect(() => {
    try {
      safeSetLocalStorage(CHAT_MODEL_KEY, selectedModels[0] ?? DEFAULT_MODEL_ID)
      safeSetLocalStorage(ACT_MODEL_KEY, selectedActModel)
      setHasStoredTextModelSelection(true)
    } catch {
      /* private browsing / blocked storage — ignore */
    }
  }, [selectedModels, selectedActModel])

  return {
    selectedActModel,
    setSelectedActModel,
    selectedModels,
    setSelectedModels,
    chatPrefsHydrated,
    hasStoredTextModelSelection,
    generationMode,
    setGenerationMode,
    generationChip,
    setGenerationChip,
    selectedImageModels,
    setSelectedImageModels,
    selectedVideoModels,
    setSelectedVideoModels,
    videoSubMode,
    setVideoSubMode,
    lastGeneratedImageUrlRef,
    reasoningByModel,
    reasoning,
    setReasoning,
    onModelReasoningChange,
    reasoningStorageKey,
  }
}

function parseStoredModelIds(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw) as unknown
    if (typeof parsed === 'string') return [parsed]
    if (Array.isArray(parsed)) return parsed.filter((value): value is string => typeof value === 'string')
  } catch {
    return [raw]
  }
  return []
}
