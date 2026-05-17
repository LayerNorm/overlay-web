import type {
  ChatModel as ServerChatModel,
  ConversationMessage,
  ConversationSummary,
} from '@overlay/app-core'
import type { ChatMode } from '@overlay/chat-core'

export type ChatModel = ServerChatModel

export interface Screenshot {
  uri: string
  base64?: string
  name: string
}

export interface ToolInvocationSummary {
  toolCallId?: string
  toolName: string
  state?: string
  toolInput?: Record<string, unknown>
  toolOutput?: unknown
}

export interface GeneratedFilePart {
  url: string
  mediaType: string
}

export interface ProviderResponse {
  modelId: string
  modelName: string
  provider: string
  content: string
  isLoading: boolean
  error?: string
}

export interface Message {
  id: string
  turnId?: string
  role: 'user' | 'assistant'
  content: string
  timestamp: number
  imageData?: string
  screenshots?: Screenshot[]
  responses?: ProviderResponse[]
  selectedModelId?: string
  reasoning?: string
  toolInvocations?: ToolInvocationSummary[]
  generatedFiles?: GeneratedFilePart[]
  mode?: ChatMode
  replyToTurnId?: string
  replySnippet?: string
  routedModelId?: string
}

export interface ChatMeta {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  lastMessage?: string
  projectId?: string
  lastMode?: ChatMode
  askModelIds?: string[]
  actModelId?: string
  clientId?: string
}

export interface Chat extends ChatMeta {
  messages: Message[]
  modelId?: string
}

export const PROVIDER_COLORS: Record<string, string> = {
  google: '#4285F4',
  openai: '#10A37F',
  anthropic: '#D97706',
  groq: '#F97316',
  xai: '#6366F1',
  nvidia: '#76B900',
  openrouter: '#111827',
  minimax: '#0F766E',
  moonshotai: '#9333EA',
  zai: '#DC2626',
  alibaba: '#EA580C',
}

export function getConversationSummaryLastMessage(
  summary: ConversationSummary,
  messages?: ConversationMessage[],
): string | undefined {
  if (messages && messages.length > 0) {
    const last = [...messages]
      .reverse()
      .find((message) => message.role === 'assistant' || message.role === 'user')
    if (last) {
      const text = last.parts
        .filter((part) => part.type === 'text')
        .map((part) => part.text || '')
        .join('')
        .trim()
      if (text) {
        return text.length > 80 ? `${text.slice(0, 80)}...` : text
      }
    }
  }

  void summary
  return undefined
}

export function generateChatId(): string {
  return `chat-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`
}

export function generateMessageId(): string {
  return `msg-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`
}

export function generateTempTitle(userMessage: string): string {
  const trimmed = userMessage.trim()
  if (trimmed.length <= 40) return trimmed
  const truncated = trimmed.slice(0, 40)
  const lastSpace = truncated.lastIndexOf(' ')
  if (lastSpace > 20) {
    return `${truncated.slice(0, lastSpace)}...`
  }
  return `${truncated}...`
}
