import AsyncStorage from '@react-native-async-storage/async-storage'
import type {
  ConversationMessage,
  ConversationSummary,
} from '@overlay/app-core'
import { appJson, appRequest } from './appApi'
import {
  generateChatId,
  getConversationSummaryLastMessage,
  type Chat,
  type ChatMeta,
  type Message,
} from './chatTypes'

const LAST_CHAT_ID_KEY = 'overlay-last-chat-id'

function toMessageContent(parts: ConversationMessage['parts']): string {
  return parts
    .filter((part) => part.type === 'text')
    .map((part) => part.text || '')
    .join('')
}

function mapConversationMessageToMessage(message: ConversationMessage): Message {
  const text = toMessageContent(message.parts)
  const generatedFiles = message.parts
    .filter(
      (part): part is Extract<ConversationMessage['parts'][number], { type: 'file' }> =>
        part.type === 'file' && !!part.url,
    )
    .map((part) => ({
      url: part.url!,
      mediaType: part.mediaType || 'application/octet-stream',
    }))

  const toolInvocations = message.parts
    .filter((part) => part.type === 'tool-invocation')
    .map((part) => ({
      toolCallId: part.toolInvocation.toolCallId,
      toolName: part.toolInvocation.toolName,
      state: part.toolInvocation.state,
      toolInput: part.toolInvocation.toolInput,
      toolOutput: part.toolInvocation.toolOutput,
    }))

  return {
    id: message.id,
    turnId: message.turnId,
    role: message.role,
    content: text,
    timestamp: Date.now(),
    selectedModelId: message.model,
    responses:
      message.role === 'assistant'
        ? [
            {
              modelId: message.model || message.routedModelId || 'overlay',
              modelName: message.routedModelId || message.model || 'Overlay',
              provider: 'overlay',
              content: text,
              isLoading: false,
            },
          ]
        : undefined,
    generatedFiles: generatedFiles.length > 0 ? generatedFiles : undefined,
    toolInvocations: toolInvocations.length > 0 ? toolInvocations : undefined,
    mode: message.mode,
    replyToTurnId: message.replyToTurnId,
    replySnippet: message.replySnippet,
    routedModelId: message.routedModelId,
  }
}

function mapConversationSummary(summary: ConversationSummary): ChatMeta {
  return {
    id: summary._id,
    title: summary.title,
    createdAt: summary.createdAt,
    updatedAt: summary.updatedAt,
    lastMessage: undefined,
    projectId: summary.projectId,
    lastMode: summary.lastMode,
    askModelIds: summary.askModelIds,
    actModelId: summary.actModelId,
    clientId: summary.clientId,
  }
}

export async function loadChatsMeta(projectId?: string): Promise<ChatMeta[]> {
  const summaries = await appJson<ConversationSummary[]>('/api/v1/conversations', {
    query: { projectId: projectId || undefined },
  })
  return summaries
    .map(mapConversationSummary)
    .sort((a, b) => b.updatedAt - a.updatedAt)
}

export async function saveChat(chat: Chat): Promise<void> {
  await appJson('/api/v1/conversations', {
    method: 'PATCH',
    json: {
      conversationId: chat.id,
      title: chat.title,
      askModelIds: chat.askModelIds,
      actModelId: chat.actModelId || chat.modelId,
      lastMode: chat.lastMode,
      projectId: chat.projectId,
    },
  })
}

export async function loadChat(id: string): Promise<Chat | null> {
  try {
    const [summary, messagesResponse] = await Promise.all([
      appJson<ConversationSummary>(`/api/v1/conversations`, {
        query: { conversationId: id },
      }),
      appJson<{ messages: ConversationMessage[] }>(`/api/v1/conversations`, {
        query: { conversationId: id, messages: true },
      }),
    ])

    const messages = messagesResponse.messages.map(mapConversationMessageToMessage)
    return {
      ...mapConversationSummary(summary),
      lastMessage: getConversationSummaryLastMessage(summary, messagesResponse.messages),
      modelId: summary.actModelId || summary.askModelIds[0],
      messages,
    }
  } catch {
    return null
  }
}

export async function deleteChat(id: string): Promise<void> {
  await appRequest('/api/v1/conversations', {
    method: 'DELETE',
    query: { conversationId: id },
  })

  const lastId = await getLastOpenedChatId()
  if (lastId === id) {
    await AsyncStorage.removeItem(LAST_CHAT_ID_KEY)
  }
}

export async function getLastOpenedChatId(): Promise<string | null> {
  return AsyncStorage.getItem(LAST_CHAT_ID_KEY)
}

export async function setLastOpenedChatId(id: string): Promise<void> {
  await AsyncStorage.setItem(LAST_CHAT_ID_KEY, id)
}

export async function updateChatTitle(id: string, title: string): Promise<void> {
  await appJson('/api/v1/conversations', {
    method: 'PATCH',
    json: { conversationId: id, title },
  })
}

export async function updateChatMessages(_id: string, _messages: Message[]): Promise<void> {
  void _id
  void _messages
}

export async function createNewChat(
  modelId?: string,
  options: { projectId?: string; title?: string } = {},
): Promise<Chat> {
  const clientId = generateChatId()
  const response = await appJson<{
    id: string
    conversation: ConversationSummary
  }>('/api/v1/conversations', {
    method: 'POST',
    json: {
      clientId,
      title: options.title || 'New Chat',
      askModelIds: modelId ? [modelId] : undefined,
      actModelId: modelId,
      lastMode: 'act',
      projectId: options.projectId,
    },
  })

  const conversation = response.conversation
  return {
    ...mapConversationSummary(conversation),
    id: conversation._id,
    modelId: conversation.actModelId || conversation.askModelIds[0],
    messages: [],
    clientId,
  }
}
