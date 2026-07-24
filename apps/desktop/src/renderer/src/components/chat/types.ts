import type { ChatModel as SharedChatModel } from '@overlay/app-core'
import type {
  ChatExchangeStatus,
  ConversationMessagePart,
  GenerationResult,
  VideoSubMode
} from '@overlay/chat-core'

export type ChatModel = SharedChatModel & {
  disabled?: boolean
  disabledReason?: string
}

export interface Screenshot {
  dataUrl?: string
  displayId: string
  name: string
  loadStatus?: 'loading' | 'loaded' | 'retrying' | 'failed'
  cachedMedia?: CachedMediaReference
}

export interface CachedMediaReference {
  cacheKey: string
  url: string
  mimeType: string
  sizeBytes: number
  name: string
}

export interface DesktopGenerationState {
  kind: 'image' | 'video'
  modelIds: string[]
  results: GenerationResult[]
  videoSubMode?: VideoSubMode
}

export interface ProviderResponse {
  modelId: string
  modelName: string
  provider: string
  content: string
  isLoading: boolean
  error?: string
  renderParts?: MessageRenderPart[]
  status?: ChatExchangeStatus
}

/**
 * Shared chat-core part shape. Desktop streaming and persistence now use the
 * same flattened ConversationMessagePart union as the web app (text, reasoning,
 * tool, file, source, data). Desktop-specific tool fields (input, output,
 * errorText) are part of the shared MessageToolPart definition.
 */
export type MessageRenderPart = ConversationMessagePart

export interface RetrievedMemory {
  id: string
  content: string
  type: 'preference' | 'fact' | 'project' | 'decision'
  importance: number
}

export interface ExtractedMemoryResult {
  id: string
  content: string
  type: 'preference' | 'fact' | 'project' | 'decision'
  importance: number
}

// Mention type for @ mentions in chat
export interface MessageMention {
  id: string
  type: 'note' | 'chat' | 'document' | 'folder' | 'file'
  title: string
  preview?: string
  folderId?: string
  filename?: string
  filepath?: string
}

export interface AgentStep {
  type:
    | 'plan'
    | 'thinking'
    | 'tool_start'
    | 'tool_result'
    | 'text'
    | 'done'
    | 'error'
    | 'checkpoint'
    | 'max_steps_reached'
    | 'history_update'
  plan?: string
  thinking?: string
  tool?: string
  toolInput?: Record<string, unknown>
  toolResult?: string
  text?: string
  error?: string
  step?: number
  stepsCompleted?: number
  maxSteps?: number
  checkpointStep?: number
  checkpointMessage?: string
  timestamp: number
}

export interface AgentMemoryCandidate {
  content: string
  type: string
  importance: number
  taskFingerprint: string
  sourceTaskId: string
}

export interface Message {
  id: string
  turnId?: string
  role: 'user' | 'assistant'
  content: string
  timestamp: number
  imageData?: string
  screenshots?: Screenshot[]
  // Multi-model support
  responses?: ProviderResponse[]
  selectedModelId?: string
  renderParts?: MessageRenderPart[]
  status?: ChatExchangeStatus
  generation?: DesktopGenerationState
  // Memory support
  retrievedMemories?: RetrievedMemory[]
  addedMemories?: ExtractedMemoryResult[]
  // Agent mode
  isAgentMessage?: boolean
  agentSteps?: AgentStep[]
  agentCommand?: string
  // Mentions (@notes, @chats, etc.)
  mentions?: MessageMention[]
}

export const PROVIDER_COLORS: Record<string, string> = {
  google: '#4285F4',
  openai: '#10A37F',
  anthropic: '#D97706',
  groq: '#F97316',
  xai: '#f1faffff',
  minimax: '#6366f1',
  openrouter: '#22c55e',
  deepseek: '#4f46e5',
  nvidia: '#76b900',
  alibaba: '#ff6a00',
  zai: '#7c3aed',
  moonshot: '#64748b'
}

export interface ChatMeta {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  isAgent?: boolean
  projectId?: string
}

export interface Chat extends ChatMeta {
  messages: Message[]
  modelId?: string
  folderId?: string
}
