import { appRequest, streamJsonSse } from './appApi'
import type { ChatModel } from './chatTypes'

interface ChatMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
  imageData?: string
  replyToTurnId?: string
  replySnippet?: string
}

export interface StreamChunk {
  type:
    | 'text'
    | 'reasoning'
    | 'tool'
    | 'file'
    | 'start'
    | 'finish'
    | 'error'
    | 'done'
  content: string
  id?: string
  toolCallId?: string
  toolName?: string
  state?: string
  input?: unknown
  output?: unknown
  url?: string
  mediaType?: string
  metadata?: unknown
}

interface ChatStreamOptions {
  conversationId?: string
  turnId?: string
  variantIndex?: number
}

type UiMessageChunk =
  | { type: 'text-delta'; delta: string; id?: string }
  | { type: 'reasoning-delta'; delta: string; id?: string }
  | {
      type: 'tool-input-available'
      toolCallId?: string
      toolName: string
      input?: unknown
    }
  | {
      type: 'tool-output-available'
      toolCallId?: string
      toolName?: string
      output?: unknown
    }
  | {
      type: 'tool-output-error'
      toolCallId?: string
      toolName?: string
      errorText: string
    }
  | { type: 'file'; url: string; mediaType?: string }
  | { type: 'start'; messageMetadata?: unknown }
  | { type: 'finish'; messageMetadata?: unknown }
  | { type: 'error'; errorText: string }

export const DEFAULT_CHAT_MODEL_ID = 'moonshotai/kimi-k2-thinking'

const AVAILABLE_CHAT_MODELS: ChatModel[] = [
  { id: 'minimaxai/minimax-m2.7', name: 'Free: Minimax 2.7', provider: 'nvidia', description: 'Best free agentic model', intelligence: 1.85, cost: 0, supportsVision: false, supportsReasoning: true, supportsSearch: false },
  { id: 'deepseek-ai/deepseek-v4-pro', name: 'Free: DeepSeek V4 Pro', provider: 'nvidia', description: 'Strong free reasoning', intelligence: 1.8, cost: 0, supportsVision: false, supportsReasoning: true, supportsSearch: false },
  { id: 'deepseek-ai/deepseek-v4-flash', name: 'Free: DeepSeek V4 Flash', provider: 'nvidia', description: 'Fast free reasoning', intelligence: 1.75, cost: 0, supportsVision: false, supportsReasoning: true, supportsSearch: false },
  { id: 'moonshotai/kimi-k2-thinking', name: 'Free: Kimi K2 Thinking', provider: 'nvidia', description: 'Default free reasoning model', intelligence: 1.7, cost: 0, supportsVision: false, supportsReasoning: true, supportsSearch: false },
  { id: 'deepseek-ai/deepseek-v3.2', name: 'Free: DeepSeek V3.2', provider: 'nvidia', description: 'General free chat', intelligence: 1.65, cost: 0, supportsVision: false, supportsReasoning: true, supportsSearch: false },
  { id: 'qwen/qwen3.6-plus', name: 'Qwen 3.6 Plus', provider: 'alibaba', description: 'Free agentic coding', intelligence: 1.6, cost: 0, supportsVision: false, supportsReasoning: true, supportsSearch: false },
  { id: 'openrouter/free', name: 'Free Router', provider: 'openrouter', description: 'Auto-selects a free model', intelligence: 1.25, cost: 0, supportsVision: true, supportsReasoning: true, supportsSearch: false },
]

export async function getAvailableModels(): Promise<ChatModel[]> {
  return AVAILABLE_CHAT_MODELS
}

export async function getModelById(modelId: string): Promise<ChatModel | undefined> {
  const models = await getAvailableModels()
  return models.find((model) => model.id === modelId)
}

function toUiMessages(messages: ChatMessage[]) {
  return messages.map((message) => ({
    role: message.role,
    parts: [
      ...(message.imageData
        ? [{ type: 'file' as const, url: message.imageData, mediaType: 'image/jpeg' }]
        : []),
      ...(message.content ? [{ type: 'text' as const, text: message.content }] : []),
    ],
    ...(message.replyToTurnId ? { replyToTurnId: message.replyToTurnId } : {}),
    ...(message.replySnippet ? { replySnippet: message.replySnippet } : {}),
  }))
}

export async function* chatStream(
  modelId: string,
  messages: ChatMessage[],
  options: ChatStreamOptions = {},
): AsyncGenerator<StreamChunk> {
  try {
    const response = await appRequest('/api/app/conversations/act', {
      method: 'POST',
      timeoutMs: 120_000,
      json: {
        modelId,
        conversationId: options.conversationId,
        turnId: options.turnId,
        variantIndex: options.variantIndex,
        messages: toUiMessages(messages),
      },
    })

    for await (const chunk of streamJsonSse<UiMessageChunk>(response)) {
      switch (chunk.type) {
        case 'text-delta':
          yield { type: 'text', content: chunk.delta, id: chunk.id }
          break
        case 'reasoning-delta':
          yield { type: 'reasoning', content: chunk.delta, id: chunk.id }
          break
        case 'tool-input-available':
          yield {
            type: 'tool',
            content: '',
            toolCallId: chunk.toolCallId,
            toolName: chunk.toolName,
            state: 'input-available',
            input: chunk.input,
          }
          break
        case 'tool-output-available':
          yield {
            type: 'tool',
            content: '',
            toolCallId: chunk.toolCallId,
            state: 'output-available',
            output: chunk.output,
          }
          break
        case 'tool-output-error':
          yield {
            type: 'tool',
            content: chunk.errorText,
            toolCallId: chunk.toolCallId,
            state: 'output-error',
          }
          break
        case 'file':
          yield {
            type: 'file',
            content: '',
            url: chunk.url,
            mediaType: chunk.mediaType,
          }
          break
        case 'start':
          yield { type: 'start', content: '', metadata: chunk.messageMetadata }
          break
        case 'finish':
          yield { type: 'finish', content: '', metadata: chunk.messageMetadata }
          break
        case 'error':
          yield { type: 'error', content: chunk.errorText }
          break
        default:
          break
      }
    }

    yield { type: 'done', content: '' }
  } catch (error) {
    yield { type: 'error', content: String(error) }
  }
}
