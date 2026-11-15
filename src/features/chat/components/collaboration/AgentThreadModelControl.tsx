'use client'

import { useEffect, useMemo, useState } from 'react'
import { ChatModelPicker } from '@overlay/chat-react'
import { MODEL_RECOMMENDATIONS, getGatewayCatalogRevision, getModelsByIntelligence } from '@/shared/ai/gateway/model-data'
import { parseByoModelId } from '@/shared/agents/agent-model'
import { useAgentDirectory } from '@/hooks/use-agent-directory'
import { useGatewayModelCatalog } from '@/components/providers/useGatewayModelCatalog'
import { useOverlayCapabilities } from '@/components/providers/CapabilitiesProvider'
import { useAppSettings } from '@/components/providers/AppSettingsProvider'
import { useWorkspaceTextModelAccess } from '@/components/providers/useWorkspaceTextModelAccess'
import { useAuth } from '@/contexts/AuthContext'

/** The agent's model, shown under the agent-thread composer like the chat model picker. */
export function AgentThreadModelControl({ agentPrincipalId }: { agentPrincipalId: string }) {
  const directory = useAgentDirectory()
  const agentModelId = directory.agents?.find((agent) => agent.principalId === agentPrincipalId)?.modelId ?? ''
  const [chosenModelId, setChosenModelId] = useState<string | null>(null)
  const { capabilities } = useOverlayCapabilities()
  const { settings } = useAppSettings()
  const { user } = useAuth()
  const { revision } = useGatewayModelCatalog({ enabled: true })
  const modelAccess = useWorkspaceTextModelAccess({
    activeWorkspaceId: directory.workspaceId,
    billingEnabled: capabilities.billing === true,
    catalogRevision: revision,
    onlyAllowZdrModels: settings.onlyAllowZdrModels,
  })
  const { loadSubscription } = modelAccess
  useEffect(() => {
    void loadSubscription()
  }, [loadSubscription])
  const allTextModels = useMemo(() => {
    void revision
    void getGatewayCatalogRevision()
    return getModelsByIntelligence()
  }, [revision])

  const modelId = chosenModelId ?? agentModelId
  if (!modelId || parseByoModelId(modelId)) return null
  const label = modelAccess.pickerTextModels.find((model) => model.id === modelId)?.name
    ?? allTextModels.find((model) => model.id === modelId)?.name
    ?? modelId
  return (
    <ChatModelPicker
      placement="composer"
      modelPickerLabel={label}
      selectableTextModels={modelAccess.pickerTextModels}
      selectedActModel={modelId}
      onToggleTextModel={setChosenModelId}
      favoriteScope={user?.id ?? null}
      modelRecommendations={MODEL_RECOMMENDATIONS}
      textModelsLoading={modelAccess.connectionsLoading}
      generationMode="text"
      lockedGenerationMode="text"
    />
  )
}
