import {
  getMessageImageAttachments,
  getMessageText,
  normalizeTranscriptAssistantParts,
  type ChatOutput,
} from '@overlay/chat-core'
import type { FunctionReturnType } from 'convex/server'
import type { api } from '../services/convexApi'
import type { ChatMentionItem, Message, ProviderResponse } from '../services/chatTypes'

export type NativePersonalMessageRow =
  FunctionReturnType<typeof api.chat.personal.getMessages>['page'][number]
type NativePersonalMessage = NativePersonalMessageRow['message']
type NativeContextUser = NonNullable<NativePersonalMessageRow['contextUser']>
type NativeOutput = NativePersonalMessageRow['outputs'][number]

function outputView(output: NativeOutput): ChatOutput {
  return {
    _id: output._id,
    type: output.type,
    status: output.status,
    prompt: output.prompt,
    modelId: output.modelId,
    ...(output.url ? { url: output.url } : {}),
    createdAt: output.createdAt,
    ...(output.turnId ? { turnId: output.turnId } : {}),
  }
}

function errorMessageFromParts(parts: readonly unknown[]): string | undefined {
  for (const value of parts) {
    if (!value || typeof value !== 'object') continue
    const part = value as { type?: unknown; data?: { message?: unknown } }
    if (part.type === 'data-native-agent-error' && typeof part.data?.message === 'string') {
      return part.data.message
    }
  }
  return undefined
}

function mapNativePersonalMessage(message: NativePersonalMessage): Message {
  const parts = message.parts ?? []
  const content = getMessageText({ parts, content: message.content })
  const status = message.status
  const errorMessage = errorMessageFromParts(parts)
  const normalized = message.role === 'assistant'
    ? normalizeTranscriptAssistantParts(parts, {
        ...(status === 'completed' || status === 'error' ? { terminalState: status } : {}),
      })
    : { blocks: undefined, sources: undefined }
  const reasoning = parts
    .filter((part) => part.type === 'reasoning' && 'text' in part && typeof part.text === 'string')
    .map((part) => 'text' in part && typeof part.text === 'string' ? part.text : '')
    .join('')
  const toolInvocations = parts
    .filter((part) => part.type === 'tool-invocation' && 'toolInvocation' in part)
    .map((part) => {
      const invocation = part.type === 'tool-invocation' ? part.toolInvocation : undefined
      return invocation ? {
        toolCallId: invocation.toolCallId,
        toolName: invocation.toolName,
        state: invocation.state,
        toolInput: invocation.toolInput,
        toolOutput: invocation.toolOutput,
      } : null
    })
    .filter((invocation): invocation is NonNullable<typeof invocation> => invocation !== null)
  const generatedFiles = parts
    .filter((part) => part.type === 'file' && 'url' in part && typeof part.url === 'string' && !!part.url)
    .map((part) => ({
      url: 'url' in part && typeof part.url === 'string' ? part.url : '',
      mediaType: 'mediaType' in part && typeof part.mediaType === 'string'
        ? part.mediaType
        : 'application/octet-stream',
    }))
  const indexedDocuments = message.userMetadata?.indexedDocuments
  const indexedAttachments = message.userMetadata?.indexedAttachments?.map((attachment) => ({
    name: attachment.name,
    fileIds: [...attachment.fileIds],
  }))
  const metadata = {
    ...(indexedDocuments ? { indexedDocuments: [...indexedDocuments] } : {}),
    ...(indexedAttachments ? { indexedAttachments } : {}),
  }
  const mentions: ChatMentionItem[] | undefined = message.userMetadata?.mentions?.map((mention) => ({
    type: mention.type as ChatMentionItem['type'],
    id: mention.id,
    name: mention.name,
    ...(mention.fileIds ? { fileIds: [...mention.fileIds] } : {}),
  }))
  const imageAttachments = message.role === 'user'
    ? getMessageImageAttachments({ parts }).map((attachment) => ({ ...attachment }))
    : undefined
  const selectedModelId = message.role === 'user' ? message.modelId : undefined
  const modelId = message.modelId
  const response: ProviderResponse | undefined = message.role === 'assistant'
    ? {
        modelId: modelId || message.routedModelId || 'overlay',
        modelName: message.routedModelId || modelId || 'Overlay',
        provider: 'overlay',
        content,
        isLoading: status === 'generating',
        variantIndex: message.variantIndex,
        blocks: normalized.blocks,
        blocksAreComplete: status !== 'generating',
        sources: normalized.sources,
        routedModelId: message.routedModelId,
        reasoning,
        toolInvocations,
        generatedFiles,
        status,
        error: errorMessage,
      }
    : undefined

  return {
    id: message._id,
    turnId: message.turnId,
    role: message.role,
    content,
    timestamp: message.createdAt,
    mode: message.mode,
    modelId,
    variantIndex: message.variantIndex,
    contentType: message.contentType,
    status,
    isStreaming: status === 'generating',
    errorMessage,
    imageAttachments,
    responses: response ? [response] : undefined,
    selectedModelId,
    reasoning: reasoning || undefined,
    toolInvocations: toolInvocations.length ? toolInvocations : undefined,
    generatedFiles: generatedFiles.length ? generatedFiles : undefined,
    blocks: normalized.blocks,
    blocksAreComplete: status !== 'generating',
    transcriptSources: normalized.sources,
    mentions,
    indexedDocuments: metadata.indexedDocuments,
    indexedAttachments: metadata.indexedAttachments,
    replyToTurnId: message.replyToTurnId,
    replySnippet: message.replySnippet,
    routedModelId: message.routedModelId,
  }
}

export function mapNativePersonalMessageRows(
  rows: readonly NativePersonalMessageRow[],
): Message[] {
  const includedUserTurns = new Set(
    rows.filter((row) => row.message.role === 'user').map((row) => row.message.turnId),
  )
  const contextUsers = new Map<string, NativeContextUser>()
  for (const row of rows) {
    const contextUser = row.contextUser
    if (
      contextUser?.role === 'user' &&
      !includedUserTurns.has(contextUser.turnId) &&
      !contextUsers.has(contextUser.turnId)
    ) {
      contextUsers.set(contextUser.turnId, contextUser)
    }
  }

  const outputsByTurn = new Map<string, Map<string, ChatOutput>>()
  for (const row of rows) {
    const turnId = row.message.turnId
    if (!row.outputs.length) continue
    const outputs = outputsByTurn.get(turnId) ?? new Map<string, ChatOutput>()
    for (const output of row.outputs) outputs.set(output._id, outputView(output))
    outputsByTurn.set(turnId, outputs)
  }

  const messages: Message[] = []
  const insertedContextTurns = new Set<string>()
  for (const row of [...rows].reverse()) {
    const message = row.message
    const turnId = message.turnId
    if (
      message.role === 'assistant' &&
      turnId &&
      contextUsers.has(turnId) &&
      !insertedContextTurns.has(turnId)
    ) {
      messages.push(mapNativePersonalMessage(contextUsers.get(turnId)!))
      insertedContextTurns.add(turnId)
    }
    messages.push(mapNativePersonalMessage(message))
  }

  return messages.map((message) => {
    if (!message.turnId) return message
    const outputs = outputsByTurn.get(message.turnId)
    if (!outputs?.size) return message
    const target = messages.find((candidate) =>
      candidate.turnId === message.turnId && candidate.role === 'user',
    ) ?? messages.find((candidate) =>
      candidate.turnId === message.turnId && candidate.role === 'assistant',
    )
    return target?.id === message.id
      ? { ...message, outputs: [...outputs.values()] }
      : message
  })
}
