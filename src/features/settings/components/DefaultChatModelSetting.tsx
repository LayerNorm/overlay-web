'use client'

import { useMemo } from 'react'
import { Bot } from 'lucide-react'
import { SettingsActionRow } from '@overlay/modules-react/settings'
import { ListboxSelect } from '@overlay/ui/primitives'
import { getEnabledChatModels } from '@/shared/ai/gateway/model-data'
import { useGatewayModelCatalog } from '@/components/providers/useGatewayModelCatalog'
import { useByokModels } from '@/components/providers/useByokModels'
import { resolveDefaultChatModelSelection } from '@/shared/chat/default-chat-model'
import { useOverlayCapabilities } from '@/components/providers/CapabilitiesProvider'

export function DefaultChatModelSetting({
  defaultActModelId,
  defaultAskModelIds,
  isFreeTier,
  onlyAllowZdrModels,
  enabledModelIds,
  modelOrder,
  disabled,
  onSelect,
}: {
  defaultActModelId?: string
  defaultAskModelIds?: readonly string[]
  isFreeTier: boolean
  onlyAllowZdrModels: boolean
  enabledModelIds: readonly string[]
  modelOrder?: readonly string[]
  disabled?: boolean
  onSelect: (actModelId: string, askModelIds: string[]) => void
}) {
  const { revision: catalogRevision } = useGatewayModelCatalog()
  const { appDataCapabilities } = useOverlayCapabilities()
  const { connections: byokConnections } = useByokModels({
    enabled: appDataCapabilities.provider === 'convex',
  })
  const effectiveOnlyAllowZdr = onlyAllowZdrModels && !isFreeTier
  const models = useMemo(() => {
    void catalogRevision
    void byokConnections
    return getEnabledChatModels(enabledModelIds, isFreeTier, modelOrder)
      .filter((model) => model.id !== 'nvidia/nemotron-nano-9b-v2')
      .filter((model) => !effectiveOnlyAllowZdr || model.supportsZeroDataRetention)
  }, [byokConnections, catalogRevision, effectiveOnlyAllowZdr, enabledModelIds, isFreeTier, modelOrder])

  const currentSelection = resolveDefaultChatModelSelection({
    defaultActModelId,
    defaultAskModelIds,
    isFreeTier,
    onlyAllowZdrModels: effectiveOnlyAllowZdr,
  })
  const currentActModelId = currentSelection.actModelId

  return (
    <SettingsActionRow
      icon={<Bot size={18} strokeWidth={1.8} />}
      title="Default model"
      description="Used when you start a new chat. Existing chats keep the model they last used."
      action={
        <ListboxSelect
          disabled={disabled}
          value={currentActModelId}
          onChange={(nextActModelId) => {
            onSelect(nextActModelId, [nextActModelId])
          }}
          options={models.map((model) => ({ value: model.id, label: model.name }))}
          className="min-w-44 max-w-full"
        />
      }
    />
  )
}
