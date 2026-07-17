'use client'

import { useMemo } from 'react'
import { Bot } from 'lucide-react'
import { SettingsActionRow } from '@overlay/modules-react/settings'
import { getEnabledChatModels } from '@/shared/ai/gateway/model-data'
import { useGatewayModelCatalog } from '@/components/providers/useGatewayModelCatalog'
import { resolveDefaultChatModelSelection } from '@/shared/chat/default-chat-model'

export function DefaultChatModelSetting({
  defaultActModelId,
  defaultAskModelIds,
  isFreeTier,
  onlyAllowZdrModels,
  enabledModelIds,
  disabled,
  onSelect,
}: {
  defaultActModelId?: string
  defaultAskModelIds?: readonly string[]
  isFreeTier: boolean
  onlyAllowZdrModels: boolean
  enabledModelIds: readonly string[]
  disabled?: boolean
  onSelect: (actModelId: string, askModelIds: string[]) => void
}) {
  const { revision: catalogRevision } = useGatewayModelCatalog()
  const effectiveOnlyAllowZdr = onlyAllowZdrModels && !isFreeTier
  const models = useMemo(() => {
    void catalogRevision
    return getEnabledChatModels(enabledModelIds, isFreeTier)
      .filter((model) => model.id !== 'nvidia/nemotron-nano-9b-v2')
      .filter((model) => !effectiveOnlyAllowZdr || model.supportsZeroDataRetention)
  }, [catalogRevision, effectiveOnlyAllowZdr, enabledModelIds, isFreeTier])

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
        <select
          disabled={disabled}
          value={currentActModelId}
          onChange={(event) => {
            const nextActModelId = event.target.value
            onSelect(nextActModelId, [nextActModelId])
          }}
          className="min-w-44 max-w-full rounded-lg border border-[var(--border)] bg-[var(--surface-subtle)] px-3 py-1.5 text-sm text-[var(--foreground)] outline-none focus:ring-1 focus:ring-[var(--foreground)] disabled:opacity-60"
        >
          {models.map((model) => (
            <option key={model.id} value={model.id}>
              {model.name}
            </option>
          ))}
        </select>
      }
    />
  )
}
