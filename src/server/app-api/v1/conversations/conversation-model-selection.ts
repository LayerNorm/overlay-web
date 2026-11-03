import { DEFAULT_MODEL_ID, isRetiredHostedModelId } from '@/shared/ai/gateway/model-types'
import { normalizeChatModelSelection } from '@/shared/chat/chat-model-prefs'

export class RetiredConversationModelSelectionError extends Error {
  constructor() {
    super('This model is retired. Choose a supported paid model before sending.')
    this.name = 'RetiredConversationModelSelectionError'
  }
}

export function resolveConversationModelSelection({
  askModelIds,
  actModelId,
}: {
  askModelIds: string[] | undefined
  actModelId: string | undefined
}): { askModelIds: string[]; actModelId: string } {
  if ([...(askModelIds ?? []), actModelId].some(isRetiredHostedModelId)) {
    throw new RetiredConversationModelSelectionError()
  }
  return normalizeChatModelSelection({ askModelIds, actModelId, fallbackModelId: DEFAULT_MODEL_ID })
}
