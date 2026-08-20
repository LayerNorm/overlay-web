'use client'

import { useEffect, useRef, useState } from 'react'
import type { AskModelSelectionMode } from '../chat-interface/types'
import type { GenerationMode, VideoSubMode } from '@/shared/ai/gateway/model-types'
import type { ReasoningLevel } from '@overlay/chat-core'
import type { PersonalChatMode } from '@overlay/ui/chat'
import {
  DEFAULT_IMAGE_MODEL_ID,
  DEFAULT_MODEL_ID,
  DEFAULT_VIDEO_MODEL_ID,
} from '@/shared/ai/gateway/model-types'
import { IMAGE_MODELS, VIDEO_MODELS } from '@/shared/ai/gateway/model-data'
import {
  readStoredReasoningLevel,
  writeStoredReasoningLevel,
} from '@/shared/chat/chat-model-prefs'
import { safeSetLocalStorage } from './model-selection-utils'
import {
  CHAT_MODEL_KEY,
  ACT_MODEL_KEY,
  CHAT_ASK_MODEL_SELECTION_MODE_KEY,
} from '@/shared/chat/chat-model-prefs'
import {
  CHAT_GEN_MODE_KEY,
  IMAGE_MODEL_SELECTION_MODE_KEY,
  SELECTED_IMAGE_MODELS_KEY,
  SELECTED_VIDEO_MODELS_KEY,
  PERSONAL_CHAT_MODE_KEY,
  VIDEO_MODEL_SELECTION_MODE_KEY,
  VIDEO_SUB_MODE_KEY,
} from '../chat-interface/constants'

export function useChatPreferences() {
  const [selectedActModel, setSelectedActModel] = useState<string>(DEFAULT_MODEL_ID)
  const [selectedModels, setSelectedModels] = useState<string[]>([DEFAULT_MODEL_ID])
  const [askModelSelectionMode, setAskModelSelectionMode] = useState<AskModelSelectionMode>('single')
  const [chatPrefsHydrated, setChatPrefsHydrated] = useState(false)
  const [hasStoredTextModelSelection, setHasStoredTextModelSelection] = useState(false)
  const [generationMode, setGenerationMode] = useState<GenerationMode>('text')
  const [personalChatMode, setPersonalChatMode] = useState<PersonalChatMode>('chat')
  const [generationChip, setGenerationChip] = useState<'image' | 'video' | null>(null)
  const [selectedImageModels, setSelectedImageModels] = useState<string[]>([DEFAULT_IMAGE_MODEL_ID])
  const [selectedVideoModels, setSelectedVideoModels] = useState<string[]>([DEFAULT_VIDEO_MODEL_ID])
  const [imageModelSelectionMode, setImageModelSelectionMode] = useState<AskModelSelectionMode>('single')
  const [videoModelSelectionMode, setVideoModelSelectionMode] = useState<AskModelSelectionMode>('single')
  const [reasoning, setReasoning] = useState<ReasoningLevel | undefined>(undefined)
  const [videoSubMode, setVideoSubMode] = useState<VideoSubMode>(() => {
    try {
      const saved = localStorage.getItem(VIDEO_SUB_MODE_KEY)
      return (saved as VideoSubMode | null) ?? 'text-to-video'
    } catch {
      return 'text-to-video'
    }
  })
  const lastGeneratedImageUrlRef = useRef<string | null>(null)

  useEffect(() => {
    try {
      const savedMode = localStorage.getItem(CHAT_GEN_MODE_KEY) as GenerationMode | null
      if (savedMode && ['text', 'image', 'video'].includes(savedMode)) setGenerationMode(savedMode)

      const savedPersonalChatMode = localStorage.getItem(PERSONAL_CHAT_MODE_KEY)
      if (savedPersonalChatMode === 'chat' || savedPersonalChatMode === 'work') {
        setPersonalChatMode(savedPersonalChatMode)
      }

      // Restore last text chat model selection if present
      try {
        const savedAskMode = localStorage.getItem(CHAT_ASK_MODEL_SELECTION_MODE_KEY)
        if (savedAskMode === 'single' || savedAskMode === 'multiple') {
          setAskModelSelectionMode(savedAskMode)
        }
        const savedModelsRaw = localStorage.getItem(CHAT_MODEL_KEY)
        const savedAct = localStorage.getItem(ACT_MODEL_KEY)
        if (savedModelsRaw) {
          const parsed = JSON.parse(savedModelsRaw) as unknown
          if (Array.isArray(parsed) && parsed.length > 0 && parsed.every((id): id is string => typeof id === 'string')) {
            setSelectedModels(parsed.slice(0, 4))
            if (savedAct && typeof savedAct === 'string') {
              setSelectedActModel(savedAct)
            } else {
              setSelectedActModel(parsed[0]!)
            }
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

      const imgMode = localStorage.getItem(IMAGE_MODEL_SELECTION_MODE_KEY)
      if (imgMode === 'single' || imgMode === 'multiple') {
        setImageModelSelectionMode(imgMode)
      }
      const vidMode = localStorage.getItem(VIDEO_MODEL_SELECTION_MODE_KEY)
      if (vidMode === 'single' || vidMode === 'multiple') {
        setVideoModelSelectionMode(vidMode)
      }
      try {
        const rawImg = localStorage.getItem(SELECTED_IMAGE_MODELS_KEY)
        if (rawImg) {
          const parsed = JSON.parse(rawImg) as unknown
          if (Array.isArray(parsed) && parsed.length > 0) {
            const allowed = new Set(IMAGE_MODELS.map((m) => m.id))
            const next = parsed.filter((id): id is string => typeof id === 'string' && allowed.has(id)).slice(0, 4)
            if (next.length > 0) setSelectedImageModels(next)
          }
        }
      } catch {
        /* keep default */
      }
      try {
        const rawVid = localStorage.getItem(SELECTED_VIDEO_MODELS_KEY)
        if (rawVid) {
          const parsed = JSON.parse(rawVid) as unknown
          if (Array.isArray(parsed) && parsed.length > 0) {
            const allowed = new Set(VIDEO_MODELS.map((m) => m.id))
            const next = parsed.filter((id): id is string => typeof id === 'string' && allowed.has(id)).slice(0, 4)
            if (next.length > 0) setSelectedVideoModels(next)
          }
        }
      } catch {
        /* keep default */
      }
    } catch {
      /* private browsing / blocked storage — keep defaults */
    } finally {
      setChatPrefsHydrated(true)
    }
  }, [])

  // Hydrate reasoning level from localStorage after mount
  useEffect(() => {
    setReasoning(readStoredReasoningLevel())
  }, [])

  const handleSetReasoning = useRef((level: ReasoningLevel | undefined) => {
    setReasoning(level)
    if (level) writeStoredReasoningLevel(level)
  }).current

  // Persist text chat model selection to localStorage so it survives
  // navigation and app restarts for the new/personal chat surface.
  useEffect(() => {
    try {
      safeSetLocalStorage(CHAT_MODEL_KEY, JSON.stringify(selectedModels))
      safeSetLocalStorage(ACT_MODEL_KEY, selectedActModel)
      safeSetLocalStorage(CHAT_ASK_MODEL_SELECTION_MODE_KEY, askModelSelectionMode)
      setHasStoredTextModelSelection(true)
    } catch {
      /* private browsing / blocked storage — ignore */
    }
  }, [selectedModels, selectedActModel, askModelSelectionMode])

  return {
    selectedActModel,
    setSelectedActModel,
    selectedModels,
    setSelectedModels,
    askModelSelectionMode,
    setAskModelSelectionMode,
    chatPrefsHydrated,
    hasStoredTextModelSelection,
    generationMode,
    setGenerationMode,
    personalChatMode,
    setPersonalChatMode,
    generationChip,
    setGenerationChip,
    selectedImageModels,
    setSelectedImageModels,
    selectedVideoModels,
    setSelectedVideoModels,
    imageModelSelectionMode,
    setImageModelSelectionMode,
    videoModelSelectionMode,
    setVideoModelSelectionMode,
    videoSubMode,
    setVideoSubMode,
    lastGeneratedImageUrlRef,
    reasoning,
    setReasoning: handleSetReasoning,
  }
}
