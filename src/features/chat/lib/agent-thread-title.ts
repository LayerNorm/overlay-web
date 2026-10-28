import { isPlaceholderChatTitle } from '@/shared/chat/chat-title'

export function shouldRenameAgentThread({
  title,
  agentName,
  hasPriorHumanMessage,
  alreadyRequested,
  hasSoloAgent,
  text,
}: {
  title: string | null | undefined
  agentName: string
  hasPriorHumanMessage: boolean
  alreadyRequested: boolean
  hasSoloAgent: boolean
  text: string
}): boolean {
  return hasSoloAgent
    && Boolean(text.trim())
    && !alreadyRequested
    && !hasPriorHumanMessage
    && (isPlaceholderChatTitle(title) || title === agentName)
}
