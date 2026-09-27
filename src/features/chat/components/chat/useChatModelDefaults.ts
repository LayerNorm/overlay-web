'use client'

import { useCallback, useEffect } from 'react'
import type { MutableRefObject } from 'react'
import { sameModelOrder, createConversationUiState } from '@overlay/chat-core'
import { resolveDefaultChatModelSelection } from '@/shared/chat/default-chat-model'
import type { useAppSettings } from '@/components/providers/AppSettingsProvider'
import type { useChatPreferences } from './useChatPreferences'
import type { AskModelSelectionMode, ConversationUiState } from '../chat-interface/types'

type ChatPrefs = ReturnType<typeof useChatPreferences>
type AppSettings = ReturnType<typeof useAppSettings>

export function useChatModelDefaults({
  settings,
  billingEnabled,
  isFreeTier,
  hasStoredTextModelSelection,
  selectedActModel,
  selectedModels,
  setSelectedActModel,
  setSelectedModels,
  setAskModelSelectionMode,
  userAskModelOverrideRef,
  askModelSelectionModeRef,
  chatPrefsHydrated,
  activeChatId,
  isTemporaryChat,
}: {
  settings: AppSettings['settings']
  billingEnabled: boolean
  isFreeTier: boolean
  hasStoredTextModelSelection: boolean
  selectedActModel: ChatPrefs['selectedActModel']
  selectedModels: ChatPrefs['selectedModels']
  setSelectedActModel: ChatPrefs['setSelectedActModel']
  setSelectedModels: ChatPrefs['setSelectedModels']
  setAskModelSelectionMode: ChatPrefs['setAskModelSelectionMode']
  userAskModelOverrideRef: MutableRefObject<boolean>
  askModelSelectionModeRef: MutableRefObject<AskModelSelectionMode>
  chatPrefsHydrated: boolean
  activeChatId: string | null
  isTemporaryChat: boolean
}) {
  const resolveAppDefaultChatModels = useCallback(() => {
    return resolveDefaultChatModelSelection({
      defaultActModelId: settings.defaultActModelId,
      defaultAskModelIds: settings.defaultAskModelIds,
      isFreeTier: billingEnabled ? isFreeTier : false,
      onlyAllowZdrModels: settings.onlyAllowZdrModels,
    })
  }, [
    billingEnabled,
    isFreeTier,
    settings.defaultActModelId,
    settings.defaultAskModelIds,
    settings.onlyAllowZdrModels,
  ])
  const applyDefaultChatModelsToView = useCallback(
    (ui: Partial<ConversationUiState>): ConversationUiState => {
      if (hasStoredTextModelSelection) {
        return createConversationUiState({
          ...ui,
          selectedActModel,
          selectedModels,
          askModelSelectionMode: selectedModels.length > 1 ? 'multiple' : 'single',
        })
      }
      const { askModelIds, actModelId } = resolveAppDefaultChatModels()
      return createConversationUiState({
        ...ui,
        selectedActModel: actModelId,
        selectedModels: askModelIds,
        askModelSelectionMode: askModelIds.length > 1 ? 'multiple' : 'single',
      })
    },
    [hasStoredTextModelSelection, resolveAppDefaultChatModels, selectedActModel, selectedModels],
  )
  // Apply account default models on new-chat surfaces when settings load or change,
  // but only if the user has no stored per-session text model preference. Stored
  // preferences win so a single-model user isn\'t forced back into multiple model
  // mode every time they return to personal chat.
  useEffect(() => {
    if (!chatPrefsHydrated || activeChatId || isTemporaryChat) return
    if (userAskModelOverrideRef.current) return
    if (hasStoredTextModelSelection) return

    const { askModelIds, actModelId } = resolveAppDefaultChatModels()
    const modeFromSettings: AskModelSelectionMode =
      askModelIds.length > 1 ? 'multiple' : 'single'
    const currentMode = askModelSelectionModeRef.current

    const modelsMatch =
      sameModelOrder(askModelIds, selectedModels) && actModelId === selectedActModel
    if (modelsMatch) {
      if (currentMode !== modeFromSettings) {
        setAskModelSelectionMode(modeFromSettings)
      }
      return
    }

    setSelectedModels(askModelIds)
    setSelectedActModel(actModelId)
    setAskModelSelectionMode(modeFromSettings)
    // selectedModels/selectedActModel are intentionally excluded: this effect applies
    // account defaults once when the new-chat surface mounts or settings change. Including
    // them creates a feedback loop because the effect itself sets those values.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    activeChatId,
    chatPrefsHydrated,
    hasStoredTextModelSelection,
    isTemporaryChat,
    resolveAppDefaultChatModels,
    setAskModelSelectionMode,
    setSelectedActModel,
    setSelectedModels,
  ])

  useEffect(() => {
    if (activeChatId || isTemporaryChat) {
      userAskModelOverrideRef.current = false
    }
  }, [activeChatId, isTemporaryChat, userAskModelOverrideRef])

  return { resolveAppDefaultChatModels, applyDefaultChatModelsToView }
}
