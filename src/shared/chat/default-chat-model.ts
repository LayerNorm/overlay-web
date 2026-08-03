import {
  FREE_TIER_AUTO_MODEL_ID,
  PAID_TIER_DEFAULT_MODEL_ID,
  isFreeTierChatModelId,
  resolveFreeTierChatModelId,
} from '@/shared/ai/gateway/model-types'
import { getModel, modelSupportsZeroDataRetention } from '@/shared/ai/gateway/model-data'
import { normalizeChatModelSelection } from '@/shared/chat/chat-model-prefs'
import { isByokModelId } from '@/shared/ai/gateway/byok-model-conversion'

export function tierDefaultActModelId(isFreeTier: boolean): string {
  return isFreeTier ? FREE_TIER_AUTO_MODEL_ID : PAID_TIER_DEFAULT_MODEL_ID
}

export function resolveDefaultChatModelSelection({
  defaultActModelId,
  defaultAskModelIds,
  isFreeTier,
  onlyAllowZdrModels = false,
}: {
  defaultActModelId?: string
  defaultAskModelIds?: readonly string[]
  isFreeTier: boolean
  onlyAllowZdrModels?: boolean
}): {
  askModelIds: string[]
  actModelId: string
} {
  const tierDefault = tierDefaultActModelId(isFreeTier)
  const hasConfiguredDefault =
    Boolean(defaultActModelId?.trim()) ||
    Boolean(defaultAskModelIds && defaultAskModelIds.length > 0)

  let actModelId = defaultActModelId
  let askModelIds = defaultAskModelIds ? [...defaultAskModelIds] : undefined

  if (isFreeTier) {
    actModelId = actModelId
      ? (isByokModelId(actModelId) ? actModelId : resolveFreeTierChatModelId(actModelId) ?? tierDefault)
      : undefined
    askModelIds = askModelIds
      ?.map((id) => isByokModelId(id) ? id : resolveFreeTierChatModelId(id))
      .filter((id): id is string => Boolean(id))
  } else if (onlyAllowZdrModels) {
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

  if (isFreeTier) {
    const actIsFree = isByokModelId(normalized.actModelId) || isFreeTierChatModelId(normalized.actModelId)
    const askAreFree = normalized.askModelIds.every(
      (id) => isByokModelId(id) || isFreeTierChatModelId(id),
    )
    if (!actIsFree || !askAreFree) {
      return normalizeChatModelSelection({
        askModelIds: [tierDefault],
        actModelId: tierDefault,
        fallbackModelId: tierDefault,
      })
    }
  }

  if (onlyAllowZdrModels && !isFreeTier) {
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
  isFreeTier,
  onlyAllowZdrModels = false,
}: {
  defaultActModelId?: string
  defaultAskModelIds?: readonly string[]
  isFreeTier: boolean
  onlyAllowZdrModels?: boolean
}): string {
  const { actModelId } = resolveDefaultChatModelSelection({
    defaultActModelId,
    defaultAskModelIds,
    isFreeTier,
    onlyAllowZdrModels,
  })
  return getModel(actModelId)?.name ?? actModelId
}
