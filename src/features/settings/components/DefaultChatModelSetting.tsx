'use client'

import { useMemo } from 'react'
import { Bot } from 'lucide-react'
import { SettingsActionRow } from '@overlay/modules-react/settings'
import { ChatModelPicker } from '@overlay/chat-react'
import { getModelsByIntelligence, MODEL_RECOMMENDATIONS } from '@/shared/ai/gateway/model-data'
import { byokConnectionsToChatModels } from '@/shared/ai/gateway/byok-model-conversion'
import { useGatewayModelCatalog } from '@/components/providers/useGatewayModelCatalog'
import { useByokModels } from '@/components/providers/useByokModels'
import { useChatReasoningPreferences } from '@/components/providers/useChatReasoningPreferences'
import { useOptionalWorkspace } from '@/contexts/WorkspaceContext'
import { useAuth } from '@/contexts/AuthContext'
import { resolveDefaultChatModelSelection } from '@/shared/chat/default-chat-model'

export function DefaultChatModelSetting({
  defaultActModelId,
  defaultAskModelIds,
  onlyAllowZdrModels,
  disabled,
  onSelect,
}: {
  defaultActModelId?: string
  defaultAskModelIds?: readonly string[]
  onlyAllowZdrModels: boolean
  disabled?: boolean
  onSelect: (actModelId: string, askModelIds: string[]) => void
}) {
  const { revision: catalogRevision } = useGatewayModelCatalog()
  const { user } = useAuth()
  const workspaceId = useOptionalWorkspace()?.activeWorkspaceId ?? 'personal'
  const { reasoningByModel, onModelReasoningChange } = useChatReasoningPreferences({ type: 'workspace', id: workspaceId })
  const { connections: byokConnections } = useByokModels()
  const effectiveOnlyAllowZdr = onlyAllowZdrModels
  const models = useMemo(() => {
    void catalogRevision
    void byokConnections
    return getModelsByIntelligence()
      .filter((model) => model.id !== 'nvidia/nemotron-nano-9b-v2')
      .filter((model) => !effectiveOnlyAllowZdr || model.supportsZeroDataRetention)
  }, [byokConnections, catalogRevision, effectiveOnlyAllowZdr])
  const pickerModels = useMemo(() => [
    ...models,
    ...byokConnectionsToChatModels(byokConnections, { includeUnavailable: true })
      .filter((model) => model.subscription?.unavailable)
      .filter((model) => !effectiveOnlyAllowZdr || model.supportsZeroDataRetention),
  ], [models, byokConnections, effectiveOnlyAllowZdr])

  const currentSelection = resolveDefaultChatModelSelection({
    defaultActModelId,
    defaultAskModelIds,
    onlyAllowZdrModels: effectiveOnlyAllowZdr,
  })
  const currentActModelId = currentSelection.actModelId

  return (
    <SettingsActionRow
      icon={<Bot size={18} strokeWidth={1.8} />}
      title="Default model"
      description="Used for new chats. Reasoning is saved for this workspace on this browser. Existing chats keep their choices."
      action={
        <div className="min-w-44 max-w-64">
          <ChatModelPicker
            placement="field"
            modelPickerLabel={pickerModels.find((model) => model.id === currentActModelId)?.name ?? currentActModelId}
            selectedActModel={currentActModelId}
            selectableTextModels={models}
            pickerTextModels={pickerModels}
            onToggleTextModel={(modelId) => onSelect(modelId, [modelId])}
            reasoningByModel={reasoningByModel}
            onModelReasoningChange={disabled ? undefined : onModelReasoningChange}
            favoriteScope={user?.id ?? null}
            modelRecommendations={MODEL_RECOMMENDATIONS}
            isActiveLoading={disabled}
            generationMode="text"
            lockedGenerationMode="text"
          />
        </div>
      }
    />
  )
}
