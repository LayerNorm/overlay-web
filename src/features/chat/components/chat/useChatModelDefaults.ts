'use client'

import { useCallback, useEffect } from 'react'
import type { MutableRefObject } from 'react'
import { createConversationUiState } from '@overlay/chat-core'
import { resolveDefaultChatModelSelection } from '@/shared/chat/default-chat-model'
import type { useAppSettings } from '@/components/providers/AppSettingsProvider'
import type { useChatPreferences } from './useChatPreferences'
import type { ConversationUiState } from '../chat-interface/types'

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
  userAskModelOverrideRef,
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
  userAskModelOverrideRef: MutableRefObject<boolean>
  chatPrefsHydrated: boolean
  activeChatId: string | null
  isTemporaryChat: boolean
}) {
  const resolveAppDefaultChatModels = useCallback(() => {
    const selection = resolveDefaultChatModelSelection({
      defaultActModelId: settings.defaultActModelId,
      defaultAskModelIds: settings.defaultAskModelIds,
      isFreeTier: billingEnabled ? isFreeTier : false,
      onlyAllowZdrModels: settings.onlyAllowZdrModels,
    })
    return { ...selection, askModelIds: selection.askModelIds.slice(0, 1) }
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
        })
      }
      const { askModelIds, actModelId } = resolveAppDefaultChatModels()
      return createConversationUiState({
        ...ui,
        selectedActModel: actModelId,
        selectedModels: askModelIds,
      })
    },
    [hasStoredTextModelSelection, resolveAppDefaultChatModels, selectedActModel, selectedModels],
  )
  // Apply account defaults to new-chat surfaces when settings load or change.
  useEffect(() => {
    if (!chatPrefsHydrated || activeChatId || isTemporaryChat) return
    if (userAskModelOverrideRef.current) return
    if (hasStoredTextModelSelection) return

    const { askModelIds, actModelId } = resolveAppDefaultChatModels()
    const modelsMatch =
      askModelIds.length === 1 &&
      askModelIds[0] === selectedModels[0] &&
      selectedModels.length === 1 &&
      actModelId === selectedActModel
    if (modelsMatch) return

    setSelectedModels(askModelIds)
    setSelectedActModel(actModelId)
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
