import AsyncStorage from '@react-native-async-storage/async-storage'
import { appRequest, appXhrStreamSse } from './appApi'
import type { ChatModel } from './chatTypes'
import { AUTH_BASE_URL } from './appConfig'

const LAST_SELECTED_MODEL_KEY = 'overlay-last-selected-model-id'

export async function getLastSelectedModelId(): Promise<string | null> {
  return AsyncStorage.getItem(LAST_SELECTED_MODEL_KEY)
}

export async function setLastSelectedModelId(modelId: string): Promise<void> {
  await AsyncStorage.setItem(LAST_SELECTED_MODEL_KEY, modelId)
}

interface ChatMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
  imageData?: string
  replyToTurnId?: string
  replySnippet?: string
}

/** Mirrors `ChatToolRequestId` in web `src/shared/chat/tool-requests.ts`. */
export type ChatToolRequestId = 'web_search' | 'memory' | 'sandbox'

export const CHAT_TOOL_REQUEST_IDS: readonly ChatToolRequestId[] = [
  'web_search',
  'memory',
  'sandbox',
]

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

export interface IndexedAttachment {
  name: string
  fileIds: string[]
}

interface ChatStreamOptions {
  conversationId?: string
  /** Client-side draft id sent for first-turn persistence (web `conversationClientId`). */
  conversationClientId?: string
  turnId?: string
  variantIndex?: number
  indexedFileNames?: string[]
  indexedAttachments?: IndexedAttachment[]
  /** Ephemeral turn — server streams but does not persist the conversation. */
  temporaryChat?: boolean
  /** 'chat' = normal; 'automate' runs the automation-capable path. */
  requestMode?: 'chat' | 'automate'
  requestedToolIds?: ChatToolRequestId[]
  memoryEnabled?: boolean
  mentions?: Array<{ type: string; id: string; name: string; fileIds?: string[] }>
  replyContextForModel?: string
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

export const DEFAULT_CHAT_MODEL_ID = 'claude-sonnet-4-6'

const AVAILABLE_CHAT_MODELS: ChatModel[] = [
  // Google Models
  { id: 'gemini-3.1-pro-preview', name: 'Gemini 3.1 Pro', provider: 'google', description: 'Most capable', intelligence: 57.2, cost: 3, speedTier: 2, supportsVision: true, supportsReasoning: true, supportsSearch: false, pricePer1mTokens: 4.5, medianOutputTokensPerSecond: 119.867 },
  { id: 'gemini-3-flash-preview', name: 'Gemini 3 Flash', provider: 'google', description: 'Fast & efficient', intelligence: 20.6, cost: 1, speedTier: 3, supportsVision: true, supportsReasoning: true, supportsSearch: false, pricePer1mTokens: 0.85, medianOutputTokensPerSecond: 186.767 },
  { id: 'google/gemma-4-26b-a4b-it', name: 'Gemma 4 26B A4B', provider: 'google', description: 'Efficient open model', intelligence: 18.8, cost: 1, speedTier: 2, supportsVision: true, supportsReasoning: true, supportsSearch: false, pricePer1mTokens: 0.537, medianOutputTokensPerSecond: 50.262 },

  // OpenAI Models
  { id: 'gpt-5.4', name: 'GPT-5.4', provider: 'openai', description: 'Powerful', intelligence: 56.8, cost: 3, speedTier: 2, supportsVision: true, supportsReasoning: true, supportsSearch: false, pricePer1mTokens: 5.625, medianOutputTokensPerSecond: 75.645 },
  { id: 'openai/gpt-5.4-mini', name: 'GPT-5.4 Mini', provider: 'openai', description: 'Compact', intelligence: 13.8, cost: 1, speedTier: 2, supportsVision: true, supportsReasoning: true, supportsSearch: false, pricePer1mTokens: 0.138, medianOutputTokensPerSecond: 120.344 },
  { id: 'gpt-4.1-2025-04-14', name: 'GPT-4.1', provider: 'openai', description: 'Reliable', intelligence: 17.3, cost: 2, speedTier: 2, supportsVision: true, supportsReasoning: true, supportsSearch: false, pricePer1mTokens: 4.375, medianOutputTokensPerSecond: 121.61 },

  // Anthropic Models
  { id: 'anthropic/claude-opus-4.7', name: 'Claude Opus 4.7', provider: 'anthropic', description: 'Most capable', intelligence: 57.3, cost: 3, speedTier: 2, supportsVision: true, supportsReasoning: true, supportsSearch: false, pricePer1mTokens: 10.938, medianOutputTokensPerSecond: 55.247 },
  { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6', provider: 'anthropic', description: 'Best balance', intelligence: 44.4, cost: 3, speedTier: 2, supportsVision: true, supportsReasoning: true, supportsSearch: false, pricePer1mTokens: 6.563, medianOutputTokensPerSecond: 53.877 },
  { id: 'claude-haiku-4-5', name: 'Claude Haiku 4.5', provider: 'anthropic', description: 'Fast & light', intelligence: 31.1, cost: 2, speedTier: 2, supportsVision: true, supportsReasoning: true, supportsSearch: false, pricePer1mTokens: 2.188, medianOutputTokensPerSecond: 102.293 },

  // xAI Models
  { id: 'xai/grok-4.20-reasoning', name: 'Grok 4.20', provider: 'xai', description: 'Flagship reasoning', intelligence: 49.3, cost: 3, speedTier: 2, supportsVision: true, supportsReasoning: true, supportsSearch: false, pricePer1mTokens: 3.0, medianOutputTokensPerSecond: 98.293 },

  // Other frontier / open models
  { id: 'deepseek/deepseek-v4-pro', name: 'DeepSeek V4 Pro', provider: 'deepseek', description: 'Flagship reasoning', intelligence: 51.5, cost: 2, speedTier: 1, supportsVision: false, supportsReasoning: true, supportsSearch: false, pricePer1mTokens: 2.175, medianOutputTokensPerSecond: 34.389 },
  { id: 'deepseek/deepseek-v4-flash', name: 'DeepSeek V4 Flash', provider: 'deepseek', description: 'Fast reasoning', intelligence: 46.5, cost: 1, speedTier: 2, supportsVision: false, supportsReasoning: true, supportsSearch: false, pricePer1mTokens: 0.175, medianOutputTokensPerSecond: 72.385 },
  { id: 'minimax/minimax-m2.7', name: 'MiniMax M2.7', provider: 'minimax', description: 'Strong agentic coding', intelligence: 49.6, cost: 1, speedTier: 1, supportsVision: false, supportsReasoning: true, supportsSearch: false, pricePer1mTokens: 0.525, medianOutputTokensPerSecond: 46.283 },
  { id: 'moonshotai/kimi-k2.6', name: 'Kimi K2.6', provider: 'moonshotai', description: 'Multimodal long-context', intelligence: 46.8, cost: 2, speedTier: 1, supportsVision: true, supportsReasoning: true, supportsSearch: false, pricePer1mTokens: 1.136, medianOutputTokensPerSecond: 48.829 },
  { id: 'z-ai/glm-5.1', name: 'GLM 5.1', provider: 'zai', description: 'Long-horizon coding', intelligence: 42.1, cost: 2, speedTier: 2, supportsVision: false, supportsReasoning: true, supportsSearch: false, pricePer1mTokens: 1.0, medianOutputTokensPerSecond: 90.037 },
  { id: 'alibaba/qwen3.6-plus', name: 'Qwen 3.6 Plus', provider: 'alibaba', description: 'Agentic coding', intelligence: 50.0, cost: 2, speedTier: 2, supportsVision: false, supportsReasoning: true, supportsSearch: false, pricePer1mTokens: 1.125, medianOutputTokensPerSecond: 52.674 },

  // Groq Models
  { id: 'openai/gpt-oss-120b', name: 'GPT OSS 120B', provider: 'groq', description: 'Open weights', intelligence: 33.3, cost: 1, speedTier: 3, supportsVision: false, supportsReasoning: true, supportsSearch: false, pricePer1mTokens: 0.262, medianOutputTokensPerSecond: 244.453 },

  // NVIDIA Gateway — internal-only title / summarization model (not shown in dropdown)
  { id: 'nvidia/nemotron-nano-9b-v2', name: 'Nemotron Nano 9B', provider: 'nvidia', description: 'Ultra-cheap summarization & tool-calling', intelligence: 13.2, cost: 1, speedTier: 2, supportsVision: false, supportsReasoning: false, supportsSearch: false, pricePer1mTokens: 0.086, medianOutputTokensPerSecond: 132.545 },

  // OpenRouter (free) — only the auto router
  { id: 'openrouter/free', name: 'Free Router', provider: 'openrouter', description: 'Auto-selects a free model', intelligence: 25.0, cost: 0, speedTier: 2, supportsVision: true, supportsReasoning: true, supportsSearch: false, pricePer1mTokens: 0, medianOutputTokensPerSecond: 100.0 },

  // NVIDIA NIM — explicit free catalog rows use NIM directly.
  { id: 'deepseek-ai/deepseek-v3.2', name: 'Free: DeepSeek V3.2', provider: 'nvidia', description: 'Free model', intelligence: 27.1, cost: 0, speedTier: 1, supportsVision: false, supportsReasoning: true, supportsSearch: false, pricePer1mTokens: 0, medianOutputTokensPerSecond: 0 },
  { id: 'moonshotai/kimi-k2-thinking', name: 'Free: Kimi K2 Thinking', provider: 'nvidia', description: 'Free model', intelligence: 40.9, cost: 0, speedTier: 2, supportsVision: false, supportsReasoning: true, supportsSearch: false, pricePer1mTokens: 0, medianOutputTokensPerSecond: 117.231 },
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
    console.log(
      '[aiService] act: baseUrl=%s conversationId=%s modelId=%s messages=%d',
      AUTH_BASE_URL,
      options.conversationId ?? 'new',
      modelId,
      messages.length,
    )
    let inThinkTag = false

    const requestMode = options.requestMode ?? 'chat'
    const body: Record<string, unknown> = {
      modelId,
      turnId: options.turnId,
      variantIndex: options.variantIndex,
      messages: toUiMessages(messages),
      mode: requestMode,
      automationMode: requestMode === 'automate',
    }
    if (options.temporaryChat) {
      body.temporaryChat = true
    } else {
      body.conversationId = options.conversationId
      if (options.conversationClientId) {
        body.conversationClientId = options.conversationClientId
        // First-turn create fields — web sends ask/act model ids so the server
        // creates the conversation with the right models.
        body.askModelIds = [modelId]
        body.actModelId = modelId
      }
    }
    if (options.indexedFileNames && options.indexedFileNames.length > 0) {
      body.indexedFileNames = options.indexedFileNames
      body.indexedAttachments = options.indexedAttachments ?? []
    }
    if (options.requestedToolIds && options.requestedToolIds.length > 0) {
      body.requestedToolIds = options.requestedToolIds
    }
    if (options.memoryEnabled !== undefined) {
      body.memoryEnabled = options.memoryEnabled
    }
    if (options.mentions && options.mentions.length > 0) {
      body.mentions = options.mentions
    }
    if (options.replyContextForModel) {
      body.replyContextForModel = options.replyContextForModel
    }

    for await (const chunk of appXhrStreamSse<UiMessageChunk>('/api/v1/conversations/act', {
      method: 'POST',
      json: body,
    })) {
      switch (chunk.type) {
        case 'text-delta': {
          let delta = chunk.delta
          if (!inThinkTag) {
            const openIdx = delta.indexOf('<think>')
            if (openIdx >= 0) {
              const before = delta.slice(0, openIdx)
              if (before) yield { type: 'text', content: before, id: chunk.id }
              inThinkTag = true
              delta = delta.slice(openIdx + 7)
              const closeIdx = delta.indexOf('</think>')
              if (closeIdx >= 0) {
                const thinking = delta.slice(0, closeIdx)
                if (thinking) yield { type: 'reasoning', content: thinking, id: chunk.id }
                inThinkTag = false
                const after = delta.slice(closeIdx + 8)
                if (after) yield { type: 'text', content: after, id: chunk.id }
              } else {
                if (delta) yield { type: 'reasoning', content: delta, id: chunk.id }
              }
            } else {
              yield { type: 'text', content: delta, id: chunk.id }
            }
          } else {
            const closeIdx = delta.indexOf('</think>')
            if (closeIdx >= 0) {
              const thinking = delta.slice(0, closeIdx)
              if (thinking) yield { type: 'reasoning', content: thinking, id: chunk.id }
              inThinkTag = false
              const after = delta.slice(closeIdx + 8)
              if (after) yield { type: 'text', content: after, id: chunk.id }
            } else {
              yield { type: 'reasoning', content: delta, id: chunk.id }
            }
          }
          break
        }
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
    console.error('[aiService] act failed:', error)
    yield { type: 'error', content: getChatErrorMessage(error) }
  }
}

export async function uploadDocument(uri: string, name: string, mimeType: string): Promise<{ ids: string[]; name: string }> {
  const form = new FormData()
  form.append('file', { uri, name, type: mimeType } as unknown as Blob)
  const res = await appRequest('/api/v1/files/ingest-document', {
    method: 'POST',
    formData: form,
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(text || 'Could not index file')
  }
  const data = (await res.json().catch(() => ({}))) as { ids?: string[]; name?: string }
  const ids = Array.isArray(data.ids) ? data.ids.map((id) => String(id)) : []
  return { ids, name: data.name ?? name }
}

export async function stopConversation(conversationId: string, messageId?: string): Promise<void> {
  const res = await appRequest('/api/v1/conversations/stop', {
    method: 'POST',
    json: {
      conversationId,
      messageId,
    },
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(text || 'Could not stop generation')
  }
}

function getChatErrorMessage(error: unknown): string {
  if (error instanceof Error && error.name === 'AbortError') {
    return 'The backend did not return a chat response before the mobile request timed out.'
  }

  if (error instanceof Error) {
    return error.message
  }

  return String(error)
}
