import { parseByokModelId } from '@/shared/ai/gateway/byok-model-conversion'
import {
  DEFAULT_MODEL_ID,
  FREE_TIER_DEFAULT_MODEL_ID,
  resolveFreeTierChatModelId,
} from '@/shared/ai/gateway/model-types'
import { normalizeChatModelSelection } from '@/shared/chat/chat-model-prefs'

function clampFreeTierAskModels(modelIds: string[] | undefined): string[] {
  const requested =
    modelIds
      ?.map(resolveFreeTierConversationModelId)
      .filter((id): id is string => Boolean(id)) ?? []
  const deduped = [...new Set(requested)].slice(0, 4)
  return deduped.length > 0 ? deduped : [FREE_TIER_DEFAULT_MODEL_ID]
}

export function resolveFreeTierConversationModelId(modelId: string | undefined): string | undefined {
  if (modelId && parseByokModelId(modelId)) return modelId
  return resolveFreeTierChatModelId(modelId)
}

export function resolveConversationModelSelection({
  isFreeTier,
  askModelIds,
  actModelId,
}: {
  isFreeTier: boolean
  askModelIds: string[] | undefined
  actModelId: string | undefined
}): { askModelIds: string[]; actModelId: string } {
  if (!isFreeTier) {
    return normalizeChatModelSelection({
      askModelIds,
      actModelId,
      fallbackModelId: DEFAULT_MODEL_ID,
    })
  }

  const freeAskModelIds = clampFreeTierAskModels(askModelIds)
  return {
    askModelIds: freeAskModelIds,
    actModelId:
      resolveFreeTierConversationModelId(actModelId) ??
      freeAskModelIds[0] ??
      FREE_TIER_DEFAULT_MODEL_ID,
  }
}
