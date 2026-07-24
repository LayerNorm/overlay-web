import type { ChatModel as SharedChatModel } from '@overlay/app-core'
import type { ChatModel } from '../components/chat/types'

export function withDisabledState(
  models: readonly SharedChatModel[],
  isFreeTier: boolean
): ChatModel[] {
  return models.map((model) => ({
    ...model,
    disabled: isFreeTier ? model.cost !== 0 : false,
    disabledReason:
      isFreeTier && model.cost !== 0 ? 'Upgrade to use this model' : undefined
  }))
}
