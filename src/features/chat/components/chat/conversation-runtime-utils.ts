import { createConversationUiState } from '@overlay/chat-core'
import type { ConversationRuntime, ConversationUiState } from '../chat-interface/types'

export function clearRuntimeMessages(runtime: ConversationRuntime) {
  runtime.askChats[0].messages = []
  runtime.actChat.messages = []
}

export function resetRuntimeState(
  runtime: ConversationRuntime,
  uiOverrides: Partial<ConversationUiState> = {},
) {
  clearRuntimeMessages(runtime)
  runtime.ui = createConversationUiState(uiOverrides)
}
