import { groupTranscriptMessages, type TranscriptMessageGroup } from '@overlay/chat-core'
import type { Message } from './types'

export interface DesktopExchangeActionTargets {
  userMessage: Message | null
  selectionMessage: Message | null
  actionMessage: Message | null
}

export function resolveDesktopExchangeActionTargets(
  group: TranscriptMessageGroup<Message> | undefined,
  selectedModelId: string
): DesktopExchangeActionTargets {
  const userMessage = group?.user ?? null
  const selectionMessage = group?.assistants[0] ?? null
  const actionMessage =
    group?.assistants.find(
      (message) =>
        message.selectedModelId === selectedModelId ||
        message.responses?.some((response) => response.modelId === selectedModelId)
    ) ??
    group?.assistants[0] ??
    userMessage

  return { userMessage, selectionMessage, actionMessage }
}

/** Resolve every persisted message belonging to a turn, with a legacy adjacency fallback. */
export function messageIdsForTurnDeletion(
  messages: readonly Message[],
  messageId: string
): Set<string> {
  const messageIndex = messages.findIndex((message) => message.id === messageId)
  if (messageIndex < 0) return new Set()

  const message = messages[messageIndex]!
  if (message.turnId) {
    return new Set(
      messages
        .filter((candidate) => candidate.turnId === message.turnId)
        .map((candidate) => candidate.id)
    )
  }

  const ids = new Set([message.id])
  if (message.role === 'assistant') {
    const previous = messages[messageIndex - 1]
    if (previous?.role === 'user') ids.add(previous.id)
  } else {
    for (let index = messageIndex + 1; index < messages.length; index += 1) {
      const candidate = messages[index]!
      if (candidate.role === 'user') break
      ids.add(candidate.id)
    }
  }
  return ids
}

/** Clone the transcript through a selected exchange so it can seed a new branch. */
export function cloneMessagesThroughTurn(
  messages: readonly Message[],
  turnId: string
): Message[] | null {
  const group = groupTranscriptMessages(messages).find((candidate) => candidate.turnId === turnId)
  if (!group) return null

  const exchangeMessageIds = new Set([
    ...(group.user ? [group.user.id] : []),
    ...group.assistants.map((message) => message.id)
  ])
  let lastMessageIndex = -1
  for (let index = 0; index < messages.length; index += 1) {
    if (exchangeMessageIds.has(messages[index]!.id)) lastMessageIndex = index
  }
  if (lastMessageIndex < 0) return null

  return structuredClone(messages.slice(0, lastMessageIndex + 1))
}
