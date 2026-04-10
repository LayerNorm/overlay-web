import { appRequest, readJsonSseStream } from './appApi'
import { getAppBootstrap } from './bootstrapService'
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
  mode?: 'ask' | 'act'
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

let cachedModels: ChatModel[] | null = null

export async function getAvailableModels(): Promise<ChatModel[]> {
  if (cachedModels) return cachedModels
  const bootstrap = await getAppBootstrap()
  cachedModels = bootstrap.chatModels
  return bootstrap.chatModels
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
    const endpoint =
      options.mode === 'ask' ? '/api/app/conversations/ask' : '/api/app/conversations/act'
    const pendingChunks: StreamChunk[] = []
    const response = await appRequest(endpoint, {
      method: 'POST',
      json: {
        modelId,
        conversationId: options.conversationId,
        turnId: options.turnId,
        variantIndex: options.variantIndex,
        messages: toUiMessages(messages),
      },
    })

    await readJsonSseStream<UiMessageChunk>(response, (chunk) => {
      switch (chunk.type) {
        case 'text-delta':
          pendingChunks.push({ type: 'text', content: chunk.delta, id: chunk.id })
          break
        case 'reasoning-delta':
          pendingChunks.push({ type: 'reasoning', content: chunk.delta, id: chunk.id })
          break
        case 'tool-input-available':
          pendingChunks.push({
            type: 'tool',
            content: '',
            toolCallId: chunk.toolCallId,
            toolName: chunk.toolName,
            state: 'input-available',
            input: chunk.input,
          })
          break
        case 'tool-output-available':
          pendingChunks.push({
            type: 'tool',
            content: '',
            toolCallId: chunk.toolCallId,
            state: 'output-available',
            output: chunk.output,
          })
          break
        case 'tool-output-error':
          pendingChunks.push({
            type: 'tool',
            content: chunk.errorText,
            toolCallId: chunk.toolCallId,
            state: 'output-error',
          })
          break
        case 'file':
          pendingChunks.push({
            type: 'file',
            content: '',
            url: chunk.url,
            mediaType: chunk.mediaType,
          })
          break
        case 'start':
          pendingChunks.push({ type: 'start', content: '', metadata: chunk.messageMetadata })
          break
        case 'finish':
          pendingChunks.push({ type: 'finish', content: '', metadata: chunk.messageMetadata })
          break
        case 'error':
          pendingChunks.push({ type: 'error', content: chunk.errorText })
          break
        default:
          break
      }
    })

    for (const chunk of pendingChunks) {
      yield chunk
    }
    yield { type: 'done', content: '' }
  } catch (error) {
    yield { type: 'error', content: String(error) }
  }
}
