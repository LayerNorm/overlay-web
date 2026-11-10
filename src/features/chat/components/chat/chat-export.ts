import type { UIMessage } from '@/shared/chat/ai-ui-message'

export function chatMessagesForExport(
  primaryMessages: readonly UIMessage[],
  getResponseForExchange: (index: number) => UIMessage | null,
  getResponsesForExchange?: (index: number) => readonly UIMessage[],
) {
  return primaryMessages.filter(message => message.role === 'user').flatMap((user, index) => {
    const responses = getResponsesForExchange?.(index)
    const selected = getResponseForExchange(index)
    return [user, ...(responses?.length ? responses : selected ? [selected] : [])]
  }).map(message => ({
    role: message.role,
    content: message.parts.filter(part => part.type === 'text').map(part => part.text).join('\n'),
    parts: message.parts,
  }))
}
