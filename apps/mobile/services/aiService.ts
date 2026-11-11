import AsyncStorage from '@react-native-async-storage/async-storage'
import { appRequest, appXhrStreamSse, getRequestWorkspaceId } from './appApi'
import type { ChatModel } from './chatTypes'
import { AUTH_BASE_URL } from './appConfig'
import { getAppBootstrap } from './bootstrapService'
import { sortChatModels } from '../lib/chatModels'
import { submitPersonalTurn, type PersonalTurn } from './personalChatService'
import { convexWorkspaceId } from './convexClient'
import { buildActStreamIdempotencyKey } from '../../src/shared/api/act-idempotency'

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
  workspaceId?: string
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

export async function getAvailableModels(): Promise<ChatModel[]> {
  return sortChatModels((await getAppBootstrap()).chatModels)
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
    const idempotencyKey = buildActStreamIdempotencyKey(options.turnId ?? '', options.variantIndex)

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

    const workspaceId = options.workspaceId ?? convexWorkspaceId()
    if (getRequestWorkspaceId() !== workspaceId) throw new Error('Workspace changed. Reopen this chat.')
    if (!options.temporaryChat) {
      const user = messages.findLast(message => message.role === 'user')
      if (!user || !options.turnId) throw new Error('This message could not be submitted.')
      const parts: PersonalTurn['parts'] = [
        ...(user.imageData ? [{ type: 'file' as const, url: user.imageData, mediaType: user.imageData.match(/^data:([^;]+);/)?.[1] ?? 'image/jpeg' }] : []),
        { type: 'text', text: user.content },
      ]
      const submitted = await submitPersonalTurn({
        conversationId: options.conversationId as PersonalTurn['conversationId'], clientId: options.conversationClientId,
        turnId: options.turnId, modelId, mode: 'act', contentType: 'text', parts,
        attachmentNames: options.indexedFileNames,
        userMetadata: { indexedAttachments: options.indexedAttachments, mentions: options.mentions as NonNullable<PersonalTurn['userMetadata']>['mentions'] },
        replyToTurnId: user.replyToTurnId, replySnippet: user.replySnippet,
      }, workspaceId)
      body.conversationId = submitted.conversationId
      delete body.conversationClientId
      yield { type: 'start', content: '', metadata: { conversationId: submitted.conversationId } }
    }

    for await (const chunk of appXhrStreamSse<UiMessageChunk>('/api/v1/conversations/act', {
      method: 'POST',
      headers: { 'x-overlay-workspace-id': workspaceId, 'Idempotency-Key': idempotencyKey },
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
