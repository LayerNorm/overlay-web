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

type RestoredRuntimeExchange<TMessage> = {
  userMsg: TMessage
  responses: Array<{ msg: TMessage }>
}

/**
 * Both runtime lists hold the full linear transcript, matching how live sends
 * append every user turn to both. A list missing earlier turns would make the
 * transcript collapse to the latest exchange after the next send.
 */
export function buildRestoredRuntimeMessages<TMessage>(
  exchanges: ReadonlyArray<RestoredRuntimeExchange<TMessage>>,
): TMessage[] {
  const linear: TMessage[] = []
  for (const exchange of exchanges) {
    linear.push(exchange.userMsg)
    if (exchange.responses[0]) linear.push(exchange.responses[0].msg)
  }
  return linear
}
