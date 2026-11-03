import { DEFAULT_MODEL_ID } from '@/shared/ai/gateway/model-types'
import { getModel, modelSupportsZeroDataRetention } from '@/shared/ai/gateway/model-data'
import { normalizeChatModelSelection } from '@/shared/chat/chat-model-prefs'

export function tierDefaultActModelId(): string {
  return DEFAULT_MODEL_ID
}

export function resolveDefaultChatModelSelection({
  defaultActModelId,
  defaultAskModelIds,
  onlyAllowZdrModels = false,
}: {
  defaultActModelId?: string
  defaultAskModelIds?: readonly string[]
  onlyAllowZdrModels?: boolean
}): {
  askModelIds: string[]
  actModelId: string
} {
  const tierDefault = tierDefaultActModelId()
  const hasConfiguredDefault =
    Boolean(defaultActModelId?.trim()) ||
    Boolean(defaultAskModelIds && defaultAskModelIds.length > 0)

  let actModelId = defaultActModelId
  let askModelIds = defaultAskModelIds ? [...defaultAskModelIds] : undefined

  if (onlyAllowZdrModels) {
    actModelId = actModelId && modelSupportsZeroDataRetention(actModelId) ? actModelId : undefined
    askModelIds = askModelIds
      ?.filter((id) => modelSupportsZeroDataRetention(id))
  }

  if (!hasConfiguredDefault) {
    return normalizeChatModelSelection({
      askModelIds: [tierDefault],
      actModelId: tierDefault,
      fallbackModelId: tierDefault,
    })
  }

  const normalized = normalizeChatModelSelection({
    askModelIds,
    actModelId,
    fallbackModelId: tierDefault,
  })

  if (onlyAllowZdrModels) {
    const actSupportsZdr = modelSupportsZeroDataRetention(normalized.actModelId)
    const askSupportZdr = normalized.askModelIds.every(modelSupportsZeroDataRetention)
    if (!actSupportsZdr || !askSupportZdr) {
      return normalizeChatModelSelection({
        askModelIds: [tierDefault],
        actModelId: tierDefault,
        fallbackModelId: tierDefault,
      })
    }
  }

  return normalized
}

export function resolveDefaultChatModelDisplayName({
  defaultActModelId,
  defaultAskModelIds,
  onlyAllowZdrModels = false,
}: {
  defaultActModelId?: string
  defaultAskModelIds?: readonly string[]
  onlyAllowZdrModels?: boolean
}): string {
  const { actModelId } = resolveDefaultChatModelSelection({
    defaultActModelId,
    defaultAskModelIds,
    onlyAllowZdrModels,
  })
  return getModel(actModelId)?.name ?? actModelId
}
