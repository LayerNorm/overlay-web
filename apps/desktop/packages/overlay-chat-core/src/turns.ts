import type { ConversationMessage } from './types'

export interface ConversationTurn<TMessage extends ConversationMessage = ConversationMessage> {
  turnId: string
  user: TMessage | null
  variants: TMessage[]
}

export function conversationTurnsFromMessages<TMessage extends ConversationMessage>(
  messages: TMessage[],
): ConversationTurn<TMessage>[] {
  const byTurn = new Map<string, ConversationTurn<TMessage>>()
  const order: string[] = []
  for (const message of messages) {
    const turnId = message.turnId ?? message.id
    let turn = byTurn.get(turnId)
    if (!turn) {
      turn = { turnId, user: null, variants: [] }
      byTurn.set(turnId, turn)
      order.push(turnId)
    }
    if (message.role === 'user') {
      turn.user = message
    } else {
      turn.variants.push(message)
    }
  }
  for (const turn of byTurn.values()) {
    turn.variants.sort((a, b) => (a.variantIndex ?? 0) - (b.variantIndex ?? 0))
  }
  return order.map((id) => byTurn.get(id)!).filter(Boolean)
}
