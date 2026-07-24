import type {
  AgentStep,
  Chat,
  ChatMeta,
  Message,
  MessageRenderPart,
  ProviderResponse
} from '../components/chat'
import type { OutputSummary } from '@overlay/app-core'
import type { GenerationResult } from '@overlay/chat-core'
import { moveChatToFolder } from './folderStorage'
import {
  desktopAppJson,
  DesktopApiError,
  overlayDesktopAppClient
} from '../services/app-api-client'
import { fetchChatListResult, type CachedChat } from '../services/chat-list-cache'
import {
  DESKTOP_GENERATION_DATA_TYPE,
  DESKTOP_ATTACHMENTS_DATA_TYPE,
  cachedAttachmentsForPersistence,
  generationStateForPersistence,
  migrateLegacyChatMedia,
  parseCachedAttachments,
  parseDesktopGenerationState
} from './chatMediaPersistence'
import { restoreGenerationResultUrl } from '../services/desktop-media-generation'

const LAST_CHAT_ID_KEY = 'overlay-last-chat-id'
export const CHATS_CHANGED_EVENT = 'overlay:chats-changed'
const META_CACHE_TTL_MS = 30_000
const CHAT_CACHE_TTL_MS = 60_000
const MESSAGE_PERSIST_FAILURE_COOLDOWN_MS = 30_000
const CONVERSATION_PATCH_FAILURE_COOLDOWN_MS = 30_000

type RemoteConversation = {
  _id: string
  title: string
  createdAt: number
  updatedAt: number
  lastModified?: number
  askModelIds?: string[]
  actModelId?: string
  lastMode?: 'ask' | 'act'
  projectId?: string
  deletedAt?: number
}

type RemoteMessage = {
  id?: string
  turnId: string
  mode: 'ask' | 'act'
  contentType: 'text' | 'image' | 'video'
  variantIndex?: number
  role: 'user' | 'assistant'
  parts?: RemoteMessagePart[]
  model?: string
  status?: 'generating' | 'completed' | 'error'
}

type RemoteMessagePart = {
  type: string
  text?: string
  url?: string
  mediaType?: string
  fileName?: string
  sourceKind?: string
  sourceId?: string
  title?: string
  filename?: string
  state?: string
  dataType?: string
  data?: unknown
  toolInvocation?: {
    toolCallId?: string
    toolName?: string
    state?: string
    toolInput?: Record<string, unknown>
    toolOutput?: unknown
  }
}

type ConversationCreateResponse = { id: string; conversation?: RemoteConversation | null }
type ConversationMessagesResponse = { messages: RemoteMessage[] }

const chatCache = new Map<string, Chat>()
const chatHydratedAt = new Map<string, number>()
let metaCache: ChatMeta[] = []
let refreshPromise: Promise<ChatMeta[]> | null = null
let lastMetaFetchedAt = 0
const persistedMessageSignatures = new Map<string, string>()
const inFlightMessagePersists = new Set<string>()
const messagePersistBlockedUntil = new Map<string, number>()
const persistedConversationSignatures = new Map<string, string>()
const inFlightConversationPatches = new Set<string>()
const conversationPatchBlockedUntil = new Map<string, number>()

function emitChatsChanged(): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(CHATS_CHANGED_EVENT))
}

function stableSerialize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableSerialize(entry)}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

function messagePersistKey(chatId: string, row: ReturnType<typeof messageRows>[number]): string {
  return [
    chatId,
    row.turnId,
    row.role,
    row.variantIndex === undefined ? 'primary' : String(row.variantIndex)
  ].join(':')
}

function messagePersistSignature(row: ReturnType<typeof messageRows>[number]): string {
  return stableSerialize({
    mode: row.mode,
    content: row.content,
    parts: row.parts,
    modelId: row.modelId,
    contentType: row.contentType
  })
}

function shouldSkipBlockedPersist(key: string, blockedUntilByKey: Map<string, number>): boolean {
  const blockedUntil = blockedUntilByKey.get(key)
  if (!blockedUntil) return false
  if (Date.now() < blockedUntil) return true
  blockedUntilByKey.delete(key)
  return false
}

function blockPersist(key: string, blockedUntilByKey: Map<string, number>): void {
  blockedUntilByKey.set(key, Date.now() + MESSAGE_PERSIST_FAILURE_COOLDOWN_MS)
}

function conversationSignature(chat: Chat): string {
  return stableSerialize({
    title: chat.title,
    modelId: chat.modelId,
    isAgent: chat.isAgent
  })
}

function markMessagesPersisted(chatId: string, messages: Message[]): void {
  for (const message of messages) {
    for (const row of messageRows(message)) {
      if (!row.content.trim()) continue
      persistedMessageSignatures.set(messagePersistKey(chatId, row), messagePersistSignature(row))
    }
  }
}

function sortMeta(metas: ChatMeta[]): ChatMeta[] {
  return [...metas].sort((a, b) => b.updatedAt - a.updatedAt)
}

function sameStoredMessage(a: Message, b: Message): boolean {
  if (a.id === b.id) return true
  if (a.turnId && b.turnId && a.turnId === b.turnId && a.role === b.role) return true
  return false
}

function upsertMessageInLocalCache(chatId: string, message: Message): void {
  const chat = chatCache.get(chatId)
  if (!chat) return

  const now = Date.now()
  const existingIndex = chat.messages.findIndex((candidate) =>
    sameStoredMessage(candidate, message)
  )
  const messages =
    existingIndex >= 0
      ? chat.messages.map((candidate, index) =>
          index === existingIndex ? { ...candidate, ...message } : candidate
        )
      : [...chat.messages, message]

  const updatedChat: Chat = {
    ...chat,
    messages,
    updatedAt: now
  }
  chatCache.set(chatId, updatedChat)
  chatHydratedAt.set(chatId, now)
  metaCache = sortMeta(
    metaCache.map((meta) => (meta.id === chatId ? { ...meta, updatedAt: now } : meta))
  )
  emitChatsChanged()
}

function textFromParts(
  parts: RemoteMessage['parts'],
  contentType: RemoteMessage['contentType']
): string {
  const text = parts
    ?.filter((part) => part.type === 'text' || part.type === 'reasoning')
    .map((part) => part.text || '')
    .join('\n')
    .trim()
  if (text) return text

  const mediaLabels =
    parts
      ?.filter((part) => part.type === 'file' || part.url || part.fileName)
      .map((part) => part.fileName || part.url || part.mediaType || '')
      .filter(Boolean) || []
  if (mediaLabels.length > 0) return mediaLabels.join('\n')
  if (contentType === 'image') return '[Image]'
  if (contentType === 'video') return '[Video]'
  return ''
}

function agentStepsFromParts(parts: RemoteMessage['parts']): AgentStep[] {
  const steps: AgentStep[] = []
  for (const part of parts || []) {
    if ((part.type === 'text' || part.type === 'reasoning') && part.text?.trim()) {
      steps.push({
        type: part.type === 'reasoning' ? 'thinking' : 'text',
        text: part.type === 'text' ? part.text : undefined,
        thinking: part.type === 'reasoning' ? part.text : undefined,
        timestamp: Date.now()
      })
      continue
    }

    if (part.type === 'tool-invocation' && part.toolInvocation?.toolName) {
      const invocation = part.toolInvocation
      steps.push({
        type: invocation.toolOutput === undefined ? 'tool_start' : 'tool_result',
        tool: invocation.toolName,
        toolInput: invocation.toolInput,
        toolResult:
          typeof invocation.toolOutput === 'string'
            ? invocation.toolOutput
            : invocation.toolOutput === undefined
              ? undefined
              : JSON.stringify(invocation.toolOutput, null, 2),
        timestamp: Date.now()
      })
    }
  }
  if (steps.length > 0 && steps[steps.length - 1]?.type !== 'done') {
    steps.push({ type: 'done', timestamp: Date.now() })
  }
  return steps
}

function renderPartsFromRemoteParts(
  parts: RemoteMessage['parts'],
  fallbackText: string,
  messageId: string
): MessageRenderPart[] {
  const renderParts: MessageRenderPart[] = []
  for (const [index, part] of (parts || []).entries()) {
    const id = `${messageId}:part:${index}`
    if (part.type === 'text' && part.text) {
      renderParts.push({ type: 'text', id, text: part.text })
      continue
    }
    if (part.type === 'reasoning' && part.text) {
      renderParts.push({ type: 'reasoning', id, text: part.text, state: 'done' })
      continue
    }
    if (part.type === 'file' && part.url && part.mediaType) {
      renderParts.push({ type: 'file', id, url: part.url, mediaType: part.mediaType })
      continue
    }
    if (
      part.type === 'source' &&
      (part.sourceKind === 'url' || part.sourceKind === 'document') &&
      part.sourceId
    ) {
      renderParts.push({
        type: 'source',
        id,
        sourceKind: part.sourceKind,
        sourceId: part.sourceId,
        ...(part.url ? { url: part.url } : {}),
        ...(part.title ? { title: part.title } : {}),
        ...(part.mediaType ? { mediaType: part.mediaType } : {}),
        ...(part.filename ? { filename: part.filename } : {})
      })
      continue
    }
    if (part.type === 'tool-invocation' && part.toolInvocation?.toolCallId) {
      const invocation = part.toolInvocation
      const toolCallId = invocation.toolCallId
      if (!toolCallId) continue
      const state = invocation.state
      renderParts.push({
        type: 'tool',
        id,
        toolCallId,
        toolName: invocation.toolName || 'unknown_tool',
        state:
          state === 'output-error' ||
          state === 'output-denied' ||
          state === 'input-error' ||
          state === 'input-streaming' ||
          state === 'input-available' ||
          state === 'output-available'
            ? state
            : invocation.toolOutput === undefined
              ? 'input-available'
              : 'output-available',
        input: invocation.toolInput,
        output: invocation.toolOutput,
        errorText:
          typeof invocation.toolOutput === 'object' &&
          invocation.toolOutput !== null &&
          'error' in invocation.toolOutput
            ? String((invocation.toolOutput as { error?: unknown }).error)
            : undefined
      })
    }
  }

  if (renderParts.length === 0 && fallbackText) {
    renderParts.push({ type: 'text', id: `${messageId}:text`, text: fallbackText })
  }
  return renderParts
}

function remoteConversationToMeta(remote: RemoteConversation | CachedChat): ChatMeta {
  return {
    id: remote._id,
    title: remote.title || 'New Chat',
    createdAt: remote.createdAt,
    updatedAt: remote.updatedAt || remote.lastModified || remote.createdAt,
    isAgent: remote.lastMode === 'act',
    projectId: remote.projectId
  }
}

function remoteConversationToChat(remote: RemoteConversation, messages: Message[] = []): Chat {
  return {
    ...remoteConversationToMeta(remote),
    messages,
    modelId: remote.actModelId || remote.askModelIds?.[0],
    folderId: remote.projectId,
    isAgent: remote.lastMode === 'act'
  }
}

function remoteMessagesToLocal(messages: RemoteMessage[]): Message[] {
  const byTurn = new Map<string, Message>()

  for (const remote of messages) {
    const content = textFromParts(remote.parts, remote.contentType)
    const generation = generationStateFromParts(remote.parts)
    const screenshots = cachedAttachmentsFromParts(remote.parts)
    const hasAgentParts =
      remote.mode === 'act' &&
      (remote.parts || []).some(
        (part) => part.type === 'tool-invocation' || part.type === 'reasoning'
      )
    if (remote.role === 'assistant' && remote.variantIndex !== undefined) {
      const existing = byTurn.get(remote.turnId)
      const response: ProviderResponse = {
        modelId: remote.model || '',
        modelName: remote.model || 'Assistant',
        provider: remote.model?.split('/')[0] || 'unknown',
        content,
        isLoading: false,
        renderParts: renderPartsFromRemoteParts(remote.parts, content, `${remote.turnId}:assistant`)
      }
      if (existing?.role === 'assistant') {
        existing.responses = [...(existing.responses || []), response]
        if (!existing.content) existing.content = content
        if (!existing.selectedModelId) existing.selectedModelId = response.modelId
        continue
      }
      byTurn.set(remote.turnId, {
        id: `${remote.turnId}:assistant`,
        turnId: remote.turnId,
        role: 'assistant',
        content,
        timestamp: Date.now(),
        responses: [response],
        selectedModelId: response.modelId,
        renderParts: response.renderParts,
        isAgentMessage: hasAgentParts,
        agentSteps: hasAgentParts ? agentStepsFromParts(remote.parts) : undefined
      })
      continue
    }

    byTurn.set(`${remote.turnId}:${remote.role}:${remote.variantIndex ?? 0}`, {
      id: `${remote.turnId}:${remote.role}`,
      turnId: remote.turnId,
      role: remote.role,
      content,
      timestamp: Date.now(),
      selectedModelId: remote.model,
      renderParts: renderPartsFromRemoteParts(
        remote.parts,
        content,
        `${remote.turnId}:${remote.role}`
      ),
      generation: generation ?? undefined,
      screenshots: screenshots.length ? screenshots : undefined,
      isAgentMessage: remote.role === 'assistant' && hasAgentParts,
      agentSteps:
        remote.role === 'assistant' && hasAgentParts ? agentStepsFromParts(remote.parts) : undefined
    })
  }

  return [...byTurn.values()]
}

function messageRows(message: Message): Array<{
  turnId: string
  role: 'user' | 'assistant'
  mode: 'ask' | 'act'
  content: string
  parts: Array<{
    type: string
    text?: string
    url?: string
    mediaType?: string
    sourceKind?: string
    sourceId?: string
    title?: string
    filename?: string
    dataType?: string
    data?: unknown
    toolInvocation?: {
      toolCallId: string
      toolName: string
      state: string
      toolInput?: unknown
      toolOutput?: unknown
    }
  }>
  modelId?: string
  contentType: 'text' | 'image' | 'video'
  variantIndex?: number
}> {
  const mode = 'act'
  const turnId = (message as { turnId?: string }).turnId || message.id
  const contentType =
    message.generation?.kind ??
    (message.imageData || message.screenshots?.length ? 'image' : 'text')
  const partsForPersistence = (
    renderParts: MessageRenderPart[] | undefined,
    fallbackText: string
  ): ReturnType<typeof messageRows>[number]['parts'] => {
    if (!renderParts?.length) return [{ type: 'text', text: fallbackText }]
    return renderParts.map((part) => {
      if (part.type === 'text') return { type: 'text', text: part.text }
      if (part.type === 'reasoning') return { type: 'reasoning', text: part.text }
      if (part.type === 'file') return { type: 'file', url: part.url, mediaType: part.mediaType }
      if (part.type === 'source') {
        return {
          type: 'source',
          sourceKind: part.sourceKind,
          sourceId: part.sourceId,
          ...(part.url ? { url: part.url } : {}),
          ...(part.title ? { title: part.title } : {}),
          ...(part.mediaType ? { mediaType: part.mediaType } : {}),
          ...(part.filename ? { filename: part.filename } : {})
        }
      }
      if (part.type === 'data') {
        return { type: 'data', dataType: part.dataType, data: part.data }
      }
      // tool parts
      return {
        type: 'tool-invocation',
        toolInvocation: {
          toolCallId: part.toolCallId,
          toolName: part.toolName,
          state: part.state,
          toolInput: part.input,
          toolOutput: part.output ?? (part.errorText ? { error: part.errorText } : undefined)
        }
      }
    })
  }
  if (message.role === 'assistant' && message.responses?.length) {
    return message.responses.map((response, index) => ({
      turnId,
      role: 'assistant',
      mode,
      content: response.content || message.content || '',
      parts: partsForPersistence(response.renderParts, response.content || message.content || ''),
      modelId: response.modelId,
      contentType: 'text',
      variantIndex: index
    }))
  }

  const content =
    message.content?.trim() ||
    (message.imageData || message.screenshots?.length ? '[Attached image]' : '')
  const parts = partsForPersistence(message.renderParts, content)
  if (message.generation) {
    parts.push({
      type: 'data',
      dataType: DESKTOP_GENERATION_DATA_TYPE,
      data: generationStateForPersistence(message.generation)
    })
  }
  const cachedAttachments = cachedAttachmentsForPersistence(message)
  if (cachedAttachments.length) {
    parts.push({
      type: 'data',
      dataType: DESKTOP_ATTACHMENTS_DATA_TYPE,
      data: cachedAttachments
    })
  }
  return [
    {
      turnId,
      role: message.role,
      mode,
      content,
      parts,
      modelId: message.selectedModelId,
      contentType
    }
  ]
}

function generationStateFromParts(parts: RemoteMessagePart[] | undefined) {
  const part = parts?.find(
    (candidate) => candidate.type === 'data' && candidate.dataType === DESKTOP_GENERATION_DATA_TYPE
  )
  return parseDesktopGenerationState(part?.data)
}

function cachedAttachmentsFromParts(parts: RemoteMessagePart[] | undefined) {
  const part = parts?.find(
    (candidate) => candidate.type === 'data' && candidate.dataType === DESKTOP_ATTACHMENTS_DATA_TYPE
  )
  return parseCachedAttachments(part?.data)
}

async function restoreCanonicalOutputs(
  messages: Message[],
  outputs: OutputSummary[]
): Promise<Message[]> {
  const restoredMessages = await Promise.all(
    messages.map(async (message) => {
      if (!message.generation) return message
      const results = await Promise.all(
        message.generation.results.map((result) =>
          restoreGenerationResultUrl(result, { force: true }).catch(() => result)
        )
      )
      return { ...message, generation: { ...message.generation, results } }
    })
  )
  const mediaOutputs = outputs
    .filter((output) => output.type === 'image' || output.type === 'video')
    .sort((a, b) => a.createdAt - b.createdAt)
  if (!mediaOutputs.length) return restoredMessages

  const existingOutputIds = new Set(
    restoredMessages.flatMap((message) =>
      (message.generation?.results ?? [])
        .map((result) => result.outputId)
        .filter((id): id is string => Boolean(id))
    )
  )
  const groups = new Map<
    string,
    {
      kind: 'image' | 'video'
      prompt: string
      turnId: string
      createdAt: number
      modelIds: string[]
      results: GenerationResult[]
    }
  >()

  for (const output of mediaOutputs) {
    if (existingOutputIds.has(output._id)) continue
    const kind = output.type as 'image' | 'video'
    const metadata = output.metadata ?? {}
    const turnId =
      typeof metadata.turnId === 'string' && metadata.turnId.trim()
        ? metadata.turnId
        : `output:${output._id}`
    const key = `${turnId}:${kind}`
    const group = groups.get(key) ?? {
      kind,
      prompt: output.prompt,
      turnId,
      createdAt: output.createdAt,
      modelIds: [],
      results: []
    }
    const baseResult: GenerationResult = {
      type: kind,
      status:
        output.status === 'pending'
          ? ('generating' as const)
          : output.status === 'completed'
            ? ('completed' as const)
            : ('failed' as const),
      modelUsed: output.modelId,
      outputId: output._id,
      error: output.errorMessage
    }
    const restored =
      output.status === 'completed'
        ? await restoreGenerationResultUrl(baseResult).catch(() => baseResult)
        : baseResult
    group.modelIds.push(output.modelId)
    group.results.push({ ...restored, url: restored.url ?? output.url })
    groups.set(key, group)
  }

  const next = restoredMessages.map((message) => ({ ...message }))
  for (const group of groups.values()) {
    const userIndex = next.findIndex(
      (message) => message.role === 'user' && message.turnId === group.turnId
    )
    const generation = {
      kind: group.kind,
      modelIds: group.modelIds,
      results: group.results
    }
    if (userIndex >= 0) {
      next[userIndex] = { ...next[userIndex], generation }
    } else {
      next.push({
        id: `${group.turnId}:user`,
        turnId: group.turnId,
        role: 'user',
        content: group.prompt,
        timestamp: group.createdAt,
        generation
      })
    }
  }
  return next.sort((a, b) => a.timestamp - b.timestamp)
}

async function fetchMessages(conversationId: string): Promise<Message[]> {
  const [response, outputs] = await Promise.all([
    desktopAppJson<ConversationMessagesResponse>(
      `/api/v1/conversations?conversationId=${encodeURIComponent(conversationId)}&messages=true`
    ),
    overlayDesktopAppClient.outputs.get({ conversationId }).catch(() => [] as OutputSummary[])
  ])
  return restoreCanonicalOutputs(remoteMessagesToLocal(response.messages || []), outputs)
}

export async function refreshChatsFromCloud(force = false): Promise<ChatMeta[]> {
  if (!force && metaCache.length > 0 && Date.now() - lastMetaFetchedAt < META_CACHE_TTL_MS) {
    return metaCache
  }
  if (refreshPromise) return refreshPromise
  refreshPromise = (async () => {
    try {
      const outcome = await fetchChatListResult({ force })
      if (outcome.status === 'unauthenticated') {
        throw new DesktopApiError('Not authenticated', 'unauthenticated', 401)
      }
      if (outcome.status === 'error') {
        throw new DesktopApiError('Failed to fetch chats', 'server', 500)
      }
      const conversations = outcome.chats
      metaCache = sortMeta(
        (conversations || []).filter((c) => !c.deletedAt).map(remoteConversationToMeta)
      )
      for (const conversation of conversations || []) {
        if (conversation.deletedAt) {
          chatCache.delete(conversation._id)
          continue
        }
        const existing = chatCache.get(conversation._id)
        chatCache.set(
          conversation._id,
          remoteConversationToChat(conversation as RemoteConversation, existing?.messages || [])
        )
      }
      lastMetaFetchedAt = Date.now()
      emitChatsChanged()
      return metaCache
    } catch (error) {
      console.warn('[CloudChat] Failed to fetch cloud conversations:', error)
      throw error
    }
  })().finally(() => {
    refreshPromise = null
  })
  return refreshPromise
}

export function loadChatsMeta(): ChatMeta[] {
  return metaCache
}

export async function listChatsMeta(force = false): Promise<ChatMeta[]> {
  return refreshChatsFromCloud(force)
}

export function loadChat(id: string): Chat | null {
  return chatCache.get(id) || null
}

export async function getChat(id: string, options: { force?: boolean } = {}): Promise<Chat | null> {
  const cached = chatCache.get(id)
  if (
    !options.force &&
    cached &&
    cached.messages.length > 0 &&
    Date.now() - (chatHydratedAt.get(id) || 0) < CHAT_CACHE_TTL_MS
  ) {
    return cached
  }

  try {
    const remote = await desktopAppJson<RemoteConversation>(
      `/api/v1/conversations?conversationId=${encodeURIComponent(id)}`
    )
    const messages = await fetchMessages(id)
    let chat = remoteConversationToChat(remote, messages)
    const migration = await migrateLegacyChatMedia(chat, window.bridge.chatMedia)
    chat = migration.chat
    chatCache.set(chat.id, chat)
    chatHydratedAt.set(chat.id, Date.now())
    markMessagesPersisted(chat.id, messages)
    persistedConversationSignatures.set(chat.id, conversationSignature(chat))
    metaCache = sortMeta([
      ...metaCache.filter((meta) => meta.id !== chat.id),
      remoteConversationToMeta(remote)
    ])
    emitChatsChanged()
    return chat
  } catch (error) {
    if (error instanceof DesktopApiError && error.code === 'not_found') {
      chatCache.delete(id)
      chatHydratedAt.delete(id)
      metaCache = metaCache.filter((meta) => meta.id !== id)
      emitChatsChanged()
      return null
    }
    throw error
  }
}

export function getLastOpenedChatId(): string | null {
  return localStorage.getItem(LAST_CHAT_ID_KEY)
}

export function setLastOpenedChatId(id: string): void {
  localStorage.setItem(LAST_CHAT_ID_KEY, id)
  emitChatsChanged()
}

export async function createNewChat(
  modelId?: string,
  folderId?: string,
  isAgent?: boolean,
  title = 'New Chat'
): Promise<Chat> {
  const created = await desktopAppJson<ConversationCreateResponse>('/api/v1/conversations', {
    method: 'POST',
    body: JSON.stringify({
      title,
      projectId: folderId,
      askModelIds: modelId ? [modelId] : undefined,
      actModelId: modelId,
      lastMode: isAgent ? 'act' : 'ask'
    })
  })
  const remote = created.conversation || {
    _id: created.id,
    title,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    askModelIds: modelId ? [modelId] : undefined,
    actModelId: modelId,
    lastMode: isAgent ? 'act' : 'ask',
    projectId: folderId
  }
  const chat = remoteConversationToChat(remote, [])
  chatCache.set(chat.id, chat)
  chatHydratedAt.set(chat.id, Date.now())
  metaCache = sortMeta([
    ...metaCache.filter((meta) => meta.id !== chat.id),
    remoteConversationToMeta(remote)
  ])
  setLastOpenedChatId(chat.id)
  if (folderId) moveChatToFolder(chat.id, folderId)
  emitChatsChanged()
  return chat
}

export async function createChatBranch(
  sourceChat: Chat,
  messages: Message[],
  fallbackModelId?: string,
  sourceTitle?: string
): Promise<Chat> {
  const title = `${sourceTitle?.trim() || sourceChat.title.trim() || 'New Chat'} branch`
  const branch = await createNewChat(
    sourceChat.modelId ?? fallbackModelId,
    sourceChat.folderId,
    sourceChat.isAgent,
    title
  )
  const branchedChat: Chat = {
    ...branch,
    title,
    messages,
    updatedAt: Date.now()
  }
  await saveChat(branchedChat)
  return branchedChat
}

export async function saveChat(chat: Chat): Promise<void> {
  chatCache.set(chat.id, { ...chat })
  chatHydratedAt.set(chat.id, Date.now())
  metaCache = sortMeta([
    ...metaCache.filter((meta) => meta.id !== chat.id),
    {
      id: chat.id,
      title: chat.title,
      createdAt: chat.createdAt,
      updatedAt: chat.updatedAt,
      isAgent: chat.isAgent
    }
  ])
  emitChatsChanged()

  await patchConversationIfChanged(chat)

  for (const message of chat.messages) {
    await appendOrReplaceMessage(chat.id, message)
  }
}

async function patchConversationIfChanged(chat: Chat): Promise<void> {
  const signature = conversationSignature(chat)
  if (persistedConversationSignatures.get(chat.id) === signature) return
  if (inFlightConversationPatches.has(chat.id)) return

  const blockedUntil = conversationPatchBlockedUntil.get(chat.id)
  if (blockedUntil && Date.now() < blockedUntil) return
  conversationPatchBlockedUntil.delete(chat.id)

  inFlightConversationPatches.add(chat.id)
  try {
    await desktopAppJson('/api/v1/conversations', {
      method: 'PATCH',
      body: JSON.stringify({
        conversationId: chat.id,
        title: chat.title,
        projectId: chat.folderId,
        askModelIds: chat.modelId ? [chat.modelId] : undefined,
        actModelId: chat.modelId,
        lastMode: chat.isAgent ? 'act' : 'ask'
      })
    })
    persistedConversationSignatures.set(chat.id, signature)
  } catch (error) {
    conversationPatchBlockedUntil.set(chat.id, Date.now() + CONVERSATION_PATCH_FAILURE_COOLDOWN_MS)
    console.warn('[CloudChat] Conversation metadata sync failed:', error)
  } finally {
    inFlightConversationPatches.delete(chat.id)
  }
}

export function upsertChatReplica(chat: Chat): void {
  chatCache.set(chat.id, chat)
  chatHydratedAt.set(chat.id, Date.now())
  metaCache = sortMeta([
    ...metaCache.filter((meta) => meta.id !== chat.id),
    {
      id: chat.id,
      title: chat.title,
      createdAt: chat.createdAt,
      updatedAt: chat.updatedAt,
      isAgent: chat.isAgent
    }
  ])
  emitChatsChanged()
}

export async function appendOrReplaceMessage(chatId: string, message: Message): Promise<void> {
  upsertMessageInLocalCache(chatId, message)

  for (const row of messageRows(message)) {
    if (!row.content.trim()) continue
    const key = messagePersistKey(chatId, row)
    const signature = messagePersistSignature(row)
    if (persistedMessageSignatures.get(key) === signature) continue
    if (inFlightMessagePersists.has(key)) continue
    if (shouldSkipBlockedPersist(key, messagePersistBlockedUntil)) continue

    inFlightMessagePersists.add(key)
    try {
      await desktopAppJson('/api/v1/conversations/message', {
        method: 'POST',
        body: JSON.stringify({
          conversationId: chatId,
          turnId: row.turnId,
          role: row.role,
          mode: row.mode,
          content: row.content,
          parts: row.parts,
          modelId: row.modelId,
          contentType: row.contentType,
          variantIndex: row.variantIndex
        })
      })
      persistedMessageSignatures.set(key, signature)
      messagePersistBlockedUntil.delete(key)
    } catch (error) {
      blockPersist(key, messagePersistBlockedUntil)
      console.warn('[CloudChat] Message sync failed:', error)
    } finally {
      inFlightMessagePersists.delete(key)
    }
  }
}

export async function deleteTurn(chatId: string, turnId: string): Promise<void> {
  await desktopAppJson('/api/v1/conversations/message', {
    method: 'DELETE',
    body: JSON.stringify({ conversationId: chatId, turnId })
  })
}

export async function deleteChat(id: string): Promise<boolean> {
  chatCache.delete(id)
  chatHydratedAt.delete(id)
  metaCache = metaCache.filter((meta) => meta.id !== id)
  if (getLastOpenedChatId() === id) localStorage.removeItem(LAST_CHAT_ID_KEY)
  emitChatsChanged()

  await desktopAppJson(`/api/v1/conversations?conversationId=${encodeURIComponent(id)}`, {
    method: 'DELETE'
  })
  return true
}

export async function updateChatTitle(id: string, title: string): Promise<void> {
  const chat = chatCache.get(id)
  if (chat) {
    chat.title = title
    chat.updatedAt = Date.now()
  }
  metaCache = sortMeta(
    metaCache.map((meta) => (meta.id === id ? { ...meta, title, updatedAt: Date.now() } : meta))
  )
  emitChatsChanged()

  await desktopAppJson('/api/v1/conversations', {
    method: 'PATCH',
    body: JSON.stringify({ conversationId: id, title })
  })
}

export function updateChatMessages(id: string, messages: Message[]): void {
  const chat = chatCache.get(id)
  if (!chat) return
  chat.messages = messages
  chat.updatedAt = Date.now()
  void saveChat(chat).catch((error) => console.error('[CloudChat] Failed to save messages:', error))
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

export function loadAllChats(): Chat[] {
  return metaCache
    .map((meta) => chatCache.get(meta.id))
    .filter((chat): chat is Chat => chat !== undefined)
}

// ---------------------------------------------------------------------------
// Local → cloud chat migration
//
// The desktop app already treats /api/v1/conversations as the canonical store
// for signed-in users, so in practice there is no legacy localStorage chat
// backlog to migrate. This shim provides the infrastructure required by the
// refactor plan so that any future legacy localStorage chats (or chats from an
// older build that stored conversations locally) are migrated once, idempotently,
// with failure backoff and without deleting local data on failure.
// ---------------------------------------------------------------------------

const LOCAL_CHATS_MIGRATION_KEY = 'overlay-local-chats-migrated'
const LEGACY_LOCAL_CHATS_KEY = 'overlay-local-chats'

export interface ChatMigrationReport {
  found: number
  migrated: number
  skipped: number
  failed: number
  alreadyMigrated: boolean
}

type LegacyLocalChat = Chat & { cloudConversationId?: string }

function readLegacyLocalChats(): LegacyLocalChat[] {
  try {
    const raw = localStorage.getItem(LEGACY_LOCAL_CHATS_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as LegacyLocalChat[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function markLegacyChatsMigrated(): void {
  try {
    localStorage.setItem(LOCAL_CHATS_MIGRATION_KEY, String(Date.now()))
  } catch {
    // ignore storage failures (private browsing)
  }
}

function hasLegacyChatsBeenMigrated(): boolean {
  try {
    return Boolean(localStorage.getItem(LOCAL_CHATS_MIGRATION_KEY))
  } catch {
    return false
  }
}

/**
 * Migrate any legacy localStorage chats to /api/v1/conversations.
 *
 * - Idempotent: subsequent calls skip work once the migration marker is set.
 * - On failure, local data is preserved and the migration marker is NOT set,
 *   so the next signed-in launch retries.
 * - Returns a report suitable for logging.
 */
export async function migrateLocalChatsToCloud(): Promise<ChatMigrationReport> {
  if (hasLegacyChatsBeenMigrated()) {
    return { found: 0, migrated: 0, skipped: 0, failed: 0, alreadyMigrated: true }
  }

  const legacyChats = readLegacyLocalChats()
  if (legacyChats.length === 0) {
    markLegacyChatsMigrated()
    return { found: 0, migrated: 0, skipped: 0, failed: 0, alreadyMigrated: false }
  }

  let migrated = 0
  let skipped = 0
  let failed = 0

  for (const legacyChat of legacyChats) {
    // Skip chats that were already migrated in a previous partial run.
    if (legacyChat.cloudConversationId) {
      skipped++
      continue
    }
    try {
      const cachedLegacy = await migrateLegacyChatMedia(legacyChat, window.bridge.chatMedia)
      if (cachedLegacy.failures > 0) {
        throw new Error('Legacy chat media cache migration did not complete')
      }
      const cloudChat = await createNewChat(
        legacyChat.modelId,
        legacyChat.folderId,
        legacyChat.isAgent,
        legacyChat.title || 'New Chat'
      )
      for (const message of cachedLegacy.chat.messages || []) {
        await appendOrReplaceMessage(cloudChat.id, message)
      }
      migrated++
    } catch (error) {
      console.warn('[CloudChat] Local chat migration failed for', legacyChat.id, error)
      failed++
    }
  }

  // Only mark migrated if every chat was migrated or skipped (no failures).
  // Failures preserve local data and trigger a retry on the next launch.
  if (failed === 0) {
    markLegacyChatsMigrated()
  }

  console.info(
    `[CloudChat] Local chat migration: found=${legacyChats.length} migrated=${migrated} skipped=${skipped} failed=${failed}`
  )
  return { found: legacyChats.length, migrated, skipped, failed, alreadyMigrated: false }
}
