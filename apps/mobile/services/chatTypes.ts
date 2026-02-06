export interface ChatModel {
  id: string
  name: string
  provider: 'openai' | 'anthropic' | 'google' | 'groq' | 'xai'
  description?: string
  supportsVision: boolean
}

export interface Screenshot {
  uri: string
  base64?: string
  name: string
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
  role: 'user' | 'assistant'
  content: string
  timestamp: number
  imageData?: string
  screenshots?: Screenshot[]
  responses?: ProviderResponse[]
  selectedModelId?: string
}

export interface ChatMeta {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  lastMessage?: string
  folderId?: string
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
  xai: '#6366F1'
}

export const AVAILABLE_MODELS: ChatModel[] = [
  // Google
  {
    id: 'gemini-2.5-flash-preview-05-20',
    name: 'Gemini 2.5 Flash',
    provider: 'google',
    description: 'Fast & efficient',
    supportsVision: true
  },
  // OpenAI
  {
    id: 'gpt-4.1-2025-04-14',
    name: 'GPT-4.1',
    provider: 'openai',
    description: 'Reliable',
    supportsVision: true
  },
  {
    id: 'gpt-4.1-mini-2025-04-14',
    name: 'GPT-4.1 Mini',
    provider: 'openai',
    description: 'Compact',
    supportsVision: true
  },
  // Anthropic
  {
    id: 'claude-sonnet-4-20250514',
    name: 'Claude Sonnet 4',
    provider: 'anthropic',
    description: 'Best balance',
    supportsVision: true
  },
  {
    id: 'claude-haiku-4-20250514',
    name: 'Claude Haiku 4',
    provider: 'anthropic',
    description: 'Fast & light',
    supportsVision: true
  },
  // Groq
  {
    id: 'llama-3.3-70b-versatile',
    name: 'Llama 3.3 70B',
    provider: 'groq',
    description: 'Versatile',
    supportsVision: false
  },
  {
    id: 'meta-llama/llama-4-scout-17b-16e-instruct',
    name: 'Llama 4 Scout',
    provider: 'groq',
    description: 'Vision',
    supportsVision: true
  },
  // xAI
  {
    id: 'grok-3-fast',
    name: 'Grok 3 Fast',
    provider: 'xai',
    description: 'Fast',
    supportsVision: true
  }
]

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
    return truncated.slice(0, lastSpace) + '...'
  }
  return truncated + '...'
}
