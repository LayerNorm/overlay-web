import type { ChatExchangeStatus, ConversationMessagePart } from '@overlay/chat-core'
import type { Message, ProviderResponse } from './types'

function hasVisiblePart(parts: readonly ConversationMessagePart[] | undefined): boolean {
  return Boolean(parts?.some((part) => {
    if (part.type === 'text' || part.type === 'reasoning') return part.text.trim().length > 0
    return part.type !== 'data' || !part.transient
  }))
}

function hasExecutingTool(parts: readonly ConversationMessagePart[] | undefined): boolean {
  return Boolean(parts?.some((part) =>
    part.type === 'tool' && (part.state === 'input-streaming' || part.state === 'input-available')
  ))
}

export function deriveDesktopProviderResponseStatus(
  response: Pick<ProviderResponse, 'content' | 'error' | 'isLoading' | 'renderParts' | 'status'>,
  options: { streaming?: boolean; interrupted?: boolean } = {}
): ChatExchangeStatus {
  if (response.error || response.status === 'error') return 'error'
  if (options.interrupted || response.status === 'interrupted' || response.status === 'cancelled') {
    return 'interrupted'
  }

  const active = options.streaming || response.isLoading
  if (active) {
    if (hasExecutingTool(response.renderParts)) return 'executing-tool'
    if (response.content.trim() || hasVisiblePart(response.renderParts)) return 'streaming'
    return 'submitted'
  }

  if (response.status === 'submitted' || response.status === 'streaming' || response.status === 'executing-tool') {
    return response.content.trim() || hasVisiblePart(response.renderParts) ? 'completed' : 'idle'
  }
  return response.status ?? 'completed'
}

/** Settles active desktop responses once when the user stops a run. */
export function settleDesktopMessagesAsInterrupted(messages: Message[]): Message[] {
  let changed = false
  const next = messages.map((message) => {
    if (message.role !== 'assistant' || !message.responses?.some((response) => response.isLoading)) {
      return message
    }
    changed = true
    return {
      ...message,
      status: 'interrupted' as const,
      responses: message.responses.map((response) => response.isLoading
        ? { ...response, isLoading: false, status: 'interrupted' as const }
        : response)
    }
  })
  return changed ? next : messages
}

/** Composer stop/send state follows active transcript data, not a stale request boolean. */
export function isDesktopComposerStreaming(
  messages: readonly Message[],
  isAgentRunning = false
): boolean {
  if (isAgentRunning) return true
  return messages.some(
    (message) =>
      message.responses?.some((response) => response.isLoading) ||
      message.generation?.results.some((result) => result.status === 'generating')
  )
}
