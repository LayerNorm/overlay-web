import {
  type BackendListItem,
  type BackendParitySnapshot,
  type BrowserScopeMode,
  type ConversationMessage,
  type ConversationMessagePart,
  type ExtensionPreferences,
  type ExtensionSession,
  resolveChatModelId,
  type LocalToolName,
  type MessageFilePart,
  type MessageTextPart,
  type MessageToolPart,
  type PageContextSnapshot,
  type StoredConversation,
  type WindowSnapshot,
  type WindowTabSnapshot,
} from '@overlay/extension-contracts'
import { appendUserIdParam, assertTrustedOverlayBaseUrl } from './trusted-origins'

function joinUrl(baseUrl: string, path: string): string {
  return `${assertTrustedOverlayBaseUrl(baseUrl)}${path}`
}

function authBody(session: ExtensionSession): { userId: string } {
  return {
    userId: session.user.id || '',
  }
}

function remoteHeaders(session: ExtensionSession, json = true): HeadersInit {
  return {
    ...(json ? { 'Content-Type': 'application/json' } : {}),
    Authorization: `Bearer ${session.accessToken}`,
  }
}

async function parseRemoteJson<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    const err = payload as { error?: string; message?: string }
    throw new Error(err.message || err.error || `Overlay API request failed (${response.status}).`)
  }
  return payload as T
}

async function remoteGet<T>(baseUrl: string, session: ExtensionSession, path: string): Promise<T> {
  const response = await fetch(joinUrl(baseUrl, appendUserIdParam(path, session.user.id || '')), {
    method: 'GET',
    headers: remoteHeaders(session, false),
    credentials: 'omit',
  })
  return parseRemoteJson<T>(response)
}

async function remoteJson<T>(
  baseUrl: string,
  session: ExtensionSession,
  path: string,
  method: 'POST' | 'PATCH' | 'DELETE',
  body: Record<string, unknown> = {},
): Promise<T> {
  const response = await fetch(joinUrl(baseUrl, path), {
    method,
    headers: remoteHeaders(session),
    credentials: 'omit',
    body: JSON.stringify({ ...body, ...authBody(session) }),
  })
  return parseRemoteJson<T>(response)
}

function sanitizeChatTitle(title: string | null | undefined, fallback = 'New Chat'): string {
  const normalized = (title || '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^["'`“”]+|["'`“”]+$/g, '')
    .replace(/[.!?,;:]+$/g, '')
    .trim()
  const limited = normalized.slice(0, 60).trim()
  return limited || fallback
}

/**
 * Safe wrapper around `chrome.tabs.sendMessage` that never surfaces the
 * cryptic "Could not establish connection. Receiving end does not exist."
 * error that Chrome throws when the target tab has no listener registered
 * (e.g., host tab open before the extension loaded, wrong origin, or
 * bridge.js not yet injected). Returns `null` on failure so callers can
 * fall through to a better user-facing error.
 */
async function sendHostTabMessage<T>(
  tabId: number,
  message: unknown,
): Promise<T | null> {
  try {
    const response = (await chrome.tabs.sendMessage(tabId, message)) as T
    return response ?? null
  } catch {
    return null
  }
}

async function findHostTab(baseUrl: string): Promise<number | null> {
  const origin = new URL(assertTrustedOverlayBaseUrl(baseUrl)).origin
  const tabs = await chrome.tabs.query({})
  const tab = tabs.find((item) => {
    if (!item.id || !item.url) return false
    try {
      return new URL(item.url).origin === origin
    } catch {
      return false
    }
  })
  return tab?.id ?? null
}

export async function refreshOverlaySession(session: ExtensionSession): Promise<ExtensionSession> {
  if (!session.refreshToken?.trim()) {
    throw new Error('No refresh token is available for this session.')
  }

  const response = await fetch(joinUrl(session.baseUrl, '/api/auth/native/refresh'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      refreshToken: session.refreshToken,
      userId: session.user.id,
      user: session.user.id ? { id: session.user.id } : undefined,
    }),
  })

  const payload = await response.json().catch(() => ({})) as {
    error?: string
    session?: {
      accessToken: string
      refreshToken?: string
      user?: {
        id?: string
        email?: string
        firstName?: string
        lastName?: string
      }
    }
  }

  if (!response.ok || !payload.session?.accessToken) {
    throw new Error(payload.error || 'Failed to refresh Overlay session.')
  }

  return {
    ...session,
    status: 'connected',
    accessToken: payload.session.accessToken,
    refreshToken: payload.session.refreshToken || session.refreshToken,
    user: {
      id: payload.session.user?.id || session.user.id,
      email: payload.session.user?.email || session.user.email,
      firstName: payload.session.user?.firstName || session.user.firstName,
      lastName: payload.session.user?.lastName || session.user.lastName,
    },
    lastValidatedAt: Date.now(),
    refreshError: null,
  }
}

export function createBearerHeaders(session: ExtensionSession | null): HeadersInit {
  if (!session?.accessToken?.trim()) return {}
  return {
    Authorization: `Bearer ${session.accessToken}`,
    'Content-Type': 'application/json',
  }
}

export function buildBrowserContextPrompt(args: {
  question: string
  scope: BrowserScopeMode
  pageContext: PageContextSnapshot | null
  windowTabs: WindowTabSnapshot[]
}): string {
  const sections: string[] = [args.question]

  const context: string[] = []
  context.push(`Scope: ${args.scope}`)
  if (args.pageContext) {
    context.push(`Active page title: ${args.pageContext.title}`)
    context.push(`Active page URL: ${args.pageContext.url}`)
    if (args.pageContext.selection) context.push(`Selected text: ${args.pageContext.selection}`)
    if (typeof args.pageContext.scrollY === 'number') context.push(`Scroll Y: ${Math.round(args.pageContext.scrollY)}`)
    if (
      typeof args.pageContext.viewportWidth === 'number' &&
      typeof args.pageContext.viewportHeight === 'number'
    ) {
      context.push(`Viewport: ${args.pageContext.viewportWidth}x${args.pageContext.viewportHeight}`)
    }
    if (args.pageContext.focusedElement?.tagName) {
      context.push(
        `Focused element: ${args.pageContext.focusedElement.tagName}${args.pageContext.focusedElement.text ? ` (${args.pageContext.focusedElement.text})` : ''}`,
      )
    }
    if (args.pageContext.headings.length > 0) {
      context.push(`Headings: ${args.pageContext.headings.slice(0, 8).join(' | ')}`)
    }
    if (args.pageContext.interactiveElements?.length) {
      context.push(
        `Visible interactive elements: ${args.pageContext.interactiveElements
          .slice(0, 8)
          .map((element, index) => `${index + 1}. ${element.tagName}${element.text ? ` (${element.text})` : ''}`)
          .join(' | ')}`,
      )
    }
    if (args.pageContext.excerpt) context.push(`Page excerpt: ${args.pageContext.excerpt}`)
  }
  if (args.windowTabs.length > 0) {
    context.push(
      `Current window tabs:\n${args.windowTabs
        .slice(0, 12)
        .map((tab, index) => `${index + 1}. ${tab.title}${tab.active ? ' (active)' : ''} — ${tab.url}`)
        .join('\n')}`,
    )
  }

  sections.push(`Browser context:\n${context.join('\n')}`)
  return sections.join('\n\n')
}

function summarizeUnknownJson(value: unknown): string {
  if (value == null) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  try {
    return JSON.stringify(value)
  } catch {
    return ''
  }
}

function summarizeMessageForModel(message: ConversationMessage): string {
  return message.parts
    .map((part) => {
      switch (part.type) {
        case 'text':
          return part.text.trim()
        case 'reasoning':
          return part.text.trim()
        case 'tool':
          return [
            `Tool ${part.toolName}`,
            `state=${part.state}`,
            part.input ? `input=${summarizeUnknownJson(part.input)}` : null,
            part.output ? `output=${summarizeUnknownJson(part.output)}` : null,
            part.errorText ? `error=${part.errorText}` : null,
          ]
            .filter(Boolean)
            .join(' ')
        case 'source':
          return part.title || part.url || part.filename || ''
        case 'file':
          return `[File: ${part.mediaType}]`
        case 'data':
          return ''
      }
    })
    .filter(Boolean)
    .join('\n\n')
}

interface UiMessageChunk {
  type: string
  [key: string]: unknown
}

export interface ActPlannerToolRequest {
  toolName: LocalToolName
  summary: string
  readOnly?: boolean
  args: Record<string, unknown>
  target?: {
    tabId?: number
    windowId?: number
    url?: string
    selector?: string
    text?: string
    coordinates?: { x: number; y: number }
  }
}

export interface ActPlannerResponse {
  assistantText: string
  statusLabel: string
  complete: boolean
  toolRequest: ActPlannerToolRequest | null
}

export function parseSseBlock(block: string): UiMessageChunk | null {
  const data = block
    .split(/\r?\n/)
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trimStart())
    .join('\n')

  if (!data || data === '[DONE]') return null

  try {
    return JSON.parse(data) as UiMessageChunk
  } catch {
    return null
  }
}

export async function consumeUiMessageEventStream(
  stream: ReadableStream<Uint8Array<ArrayBufferLike>>,
  onChunk: (chunk: UiMessageChunk) => Promise<void> | void,
): Promise<void> {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })

    while (true) {
      const splitIndex = buffer.indexOf('\n\n')
      if (splitIndex < 0) break

      const block = buffer.slice(0, splitIndex)
      buffer = buffer.slice(splitIndex + 2)

      const parsed = parseSseBlock(block)
      if (parsed) {
        await onChunk(parsed)
      }
    }
  }

  buffer += decoder.decode()
  const trailing = parseSseBlock(buffer)
  if (trailing) {
    await onChunk(trailing)
  }
}

export async function probeRemoteAccount(baseUrl: string): Promise<{
  email?: string
  firstName?: string
  lastName?: string
} | null> {
  const tabId = await findHostTab(baseUrl)
  if (!tabId) return null
  const response = await sendHostTabMessage<{
    authenticated?: boolean
    user?: { email?: string; firstName?: string; lastName?: string } | null
  }>(tabId, { type: 'overlay.host.session' })
  if (!response?.authenticated) return null
  return response.user ?? null
}

type RemoteConversationSummary = {
  _id: string
  title: string
  lastModified?: number
  updatedAt?: number
  createdAt?: number
  lastMode?: 'ask' | 'act'
  askModelIds?: string[]
  actModelId?: string
  projectId?: string
}

type RemoteConversationMessage = {
  id: string
  turnId: string
  role: 'user' | 'assistant'
  mode?: 'ask' | 'act'
  contentType?: 'text' | 'image' | 'video'
  variantIndex?: number
  parts?: Array<Record<string, unknown>>
  model?: string
  routedModelId?: string
  status?: 'generating' | 'completed' | 'error'
}

function partId(prefix = 'part'): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function textFromRemoteParts(parts: ConversationMessagePart[]): string {
  return parts
    .filter((part): part is MessageTextPart => part.type === 'text')
    .map((part) => part.text.trim())
    .filter(Boolean)
    .join('\n\n')
}

function mapRemotePart(part: Record<string, unknown>): ConversationMessagePart | null {
  if (part.type === 'text') {
    return {
      type: 'text',
      id: typeof part.id === 'string' ? part.id : partId(),
      text: typeof part.text === 'string' ? part.text : '',
    } satisfies MessageTextPart
  }
  if (part.type === 'file') {
    return {
      type: 'file',
      id: typeof part.id === 'string' ? part.id : partId(),
      url: typeof part.url === 'string' ? part.url : '',
      mediaType: typeof part.mediaType === 'string' ? part.mediaType : 'application/octet-stream',
    } satisfies MessageFilePart
  }
  if (part.type === 'tool-invocation' && part.toolInvocation && typeof part.toolInvocation === 'object') {
    const invocation = part.toolInvocation as Record<string, unknown>
    const state = typeof invocation.state === 'string' ? invocation.state : 'output-available'
    const mappedState: MessageToolPart['state'] =
      state === 'input-streaming' ||
      state === 'input-available' ||
      state === 'input-error' ||
      state === 'output-available' ||
      state === 'output-error' ||
      state === 'output-denied'
        ? state
        : state.includes('error')
          ? 'output-error'
          : 'output-available'
    return {
      type: 'tool',
      id: typeof invocation.toolCallId === 'string' ? invocation.toolCallId : partId('tool'),
      toolCallId: typeof invocation.toolCallId === 'string' ? invocation.toolCallId : partId('tool-call'),
      toolName: typeof invocation.toolName === 'string' ? invocation.toolName : 'tool',
      state: mappedState,
      input: invocation.toolInput,
      output: invocation.toolOutput,
    } satisfies MessageToolPart
  }
  return null
}

function mapRemoteMessage(message: RemoteConversationMessage): ConversationMessage {
  const parts = (message.parts ?? [])
    .map(mapRemotePart)
    .filter((part): part is ConversationMessagePart => Boolean(part))
  const safeParts = parts.length > 0 ? parts : [{ type: 'text' as const, id: partId(), text: '' }]
  return {
    id: message.id,
    role: message.role,
    parts: safeParts,
    createdAt: Date.now(),
    turnId: message.turnId,
    variantIndex: message.variantIndex,
    modelId: message.routedModelId || message.model,
    metadata: {
      mode: message.mode,
      contentType: message.contentType,
      status: message.status,
    },
  }
}

function previewFromMessages(messages: ConversationMessage[]): string {
  const last = [...messages].reverse().find((message) => textFromRemoteParts(message.parts).trim())
  return last ? textFromRemoteParts(last.parts).replace(/\s+/g, ' ').slice(0, 110) : ''
}

function mapRemoteConversation(
  summary: RemoteConversationSummary,
  messages: RemoteConversationMessage[] = [],
): StoredConversation {
  const mappedMessages = messages.map(mapRemoteMessage)
  const updatedAt = summary.updatedAt ?? summary.lastModified ?? summary.createdAt ?? Date.now()
  return {
    id: summary._id,
    title: summary.title || 'New Chat',
    preview: previewFromMessages(mappedMessages),
    updatedAt,
    messages: mappedMessages,
    version: 3,
  }
}

export async function fetchRemoteAppBootstrap(args: {
  baseUrl: string
  session: ExtensionSession
}): Promise<{
  entitlements?: {
    tier: 'free' | 'pro' | 'max'
    planKind?: 'free' | 'paid'
    creditsUsed?: number
    creditsTotal?: number
  } | null
  uiSettings?: Record<string, unknown> | null
  defaults?: { chatModelId?: string; imageModelId?: string; videoModelId?: string }
} | null> {
  if (!args.session.accessToken?.trim() || !args.session.user?.id?.trim()) return null
  return remoteGet<{
    entitlements?: {
      tier: 'free' | 'pro' | 'max'
      planKind?: 'free' | 'paid'
      creditsUsed?: number
      creditsTotal?: number
    } | null
    uiSettings?: Record<string, unknown> | null
    defaults?: { chatModelId?: string; imageModelId?: string; videoModelId?: string }
  }>(args.baseUrl, args.session, '/api/v1/bootstrap').catch(() => null)
}

export async function fetchRemoteConversations(args: {
  baseUrl: string
  session: ExtensionSession
  activeConversationId?: string | null
}): Promise<StoredConversation[]> {
  if (!args.session.accessToken?.trim() || !args.session.user?.id?.trim()) return []
  const summaries = await remoteGet<RemoteConversationSummary[]>(args.baseUrl, args.session, '/api/v1/conversations')
  const activeId = args.activeConversationId && summaries.some((item) => item._id === args.activeConversationId)
    ? args.activeConversationId
    : summaries[0]?._id
  if (!activeId) return summaries.map((summary) => mapRemoteConversation(summary))

  const activeMessages = await remoteGet<{ messages?: RemoteConversationMessage[] }>(
    args.baseUrl,
    args.session,
    `/api/v1/conversations?conversationId=${encodeURIComponent(activeId)}&messages=true`,
  ).catch(() => ({ messages: [] }))

  return summaries.map((summary) => (
    summary._id === activeId
      ? mapRemoteConversation(summary, activeMessages.messages ?? [])
      : mapRemoteConversation(summary)
  ))
}

export async function fetchRemoteConversationWithMessages(args: {
  baseUrl: string
  session: ExtensionSession
  conversationId: string
}): Promise<StoredConversation | null> {
  const [summary, messages] = await Promise.all([
    remoteGet<RemoteConversationSummary>(
      args.baseUrl,
      args.session,
      `/api/v1/conversations?conversationId=${encodeURIComponent(args.conversationId)}`,
    ),
    remoteGet<{ messages?: RemoteConversationMessage[] }>(
      args.baseUrl,
      args.session,
      `/api/v1/conversations?conversationId=${encodeURIComponent(args.conversationId)}&messages=true`,
    ),
  ]).catch(() => [null, null] as const)
  if (!summary) return null
  return mapRemoteConversation(summary, messages?.messages ?? [])
}

export async function createRemoteConversation(args: {
  baseUrl: string
  session: ExtensionSession
  title?: string
  askModelIds?: string[]
  actModelId?: string
}): Promise<StoredConversation> {
  const payload = await remoteJson<{ id?: string; conversation?: RemoteConversationSummary }>(
    args.baseUrl,
    args.session,
    '/api/v1/conversations',
    'POST',
    {
      title: args.title || 'New Chat',
      askModelIds: args.askModelIds,
      actModelId: args.actModelId,
      lastMode: 'act',
    },
  )
  const summary = payload.conversation ?? {
    _id: payload.id || partId('conversation'),
    title: args.title || 'New Chat',
    updatedAt: Date.now(),
  }
  return mapRemoteConversation(summary)
}

export async function deleteRemoteConversation(args: {
  baseUrl: string
  session: ExtensionSession
  conversationId: string
}): Promise<void> {
  await remoteJson(
    args.baseUrl,
    args.session,
    `/api/v1/conversations?conversationId=${encodeURIComponent(args.conversationId)}`,
    'DELETE',
  )
}

export async function updateRemoteConversation(args: {
  baseUrl: string
  session: ExtensionSession
  conversationId: string
  title?: string
  askModelIds?: string[]
  actModelId?: string
}): Promise<StoredConversation | null> {
  const payload = await remoteJson<{ conversation?: RemoteConversationSummary }>(
    args.baseUrl,
    args.session,
    '/api/v1/conversations',
    'PATCH',
    {
      conversationId: args.conversationId,
      title: args.title,
      askModelIds: args.askModelIds,
      actModelId: args.actModelId,
    },
  )
  return payload.conversation ? mapRemoteConversation(payload.conversation) : null
}

function buildActPlannerPayload(args: {
  preferences: ExtensionPreferences
  session: ExtensionSession | null
  conversation: StoredConversation
  pageContext: PageContextSnapshot | null
  windowTabs: WindowTabSnapshot[]
  windows: WindowSnapshot[]
}) {
  return {
    modelId: resolveChatModelId(args.preferences),
    messages: args.conversation.messages
      .map((message) => ({
        role: message.role,
        content: summarizeMessageForModel(message).trim(),
      }))
      .filter((message) => message.content),
    pageContext: args.pageContext,
    windowTabs: args.windowTabs,
    windows: args.windows,
    userId: args.session?.user?.id,
  }
}

async function parseJsonResponse<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    const failure = payload as { error?: string; message?: string }
    throw new Error(failure.message || failure.error || `Remote request failed (${response.status}).`)
  }
  return payload as T
}

export async function runRemoteActPlanner(args: {
  preferences: ExtensionPreferences
  session: ExtensionSession | null
  conversation: StoredConversation
  pageContext: PageContextSnapshot | null
  windowTabs: WindowTabSnapshot[]
  windows: WindowSnapshot[]
}): Promise<ActPlannerResponse> {
  const payload = buildActPlannerPayload(args)
  const endpoint = '/api/v1/conversations/act/extension-plan'
  const hasBearer = Boolean(args.session?.accessToken?.trim() && args.session?.user?.id?.trim())

  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (hasBearer && args.session?.accessToken) {
    headers.Authorization = `Bearer ${args.session.accessToken}`
  }

  let response: Response | null = null
  try {
    response = await fetch(joinUrl(args.preferences.baseUrl, endpoint), {
      method: 'POST',
      credentials: hasBearer ? 'omit' : 'include',
      headers,
      body: JSON.stringify(payload),
    })
  } catch {
    response = null
  }

  if (response?.ok) {
    return parseJsonResponse<ActPlannerResponse>(response)
  }

  if (response && hasBearer) {
    const err = (await response.json().catch(() => ({}))) as { message?: string; error?: string }
    throw new Error(
      response.status === 401
        ? 'Session expired or not signed in. Open the extension sidebar → Account settings → Connect.'
        : err.message || err.error || `Remote act planner failed (${response.status}).`,
    )
  }

  const hostTabId = await findHostTab(args.preferences.baseUrl)
  if (hostTabId) {
    const proxied = await sendHostTabMessage<{
      ok?: boolean
      status?: number
      payload?: ActPlannerResponse
      error?: string
    }>(hostTabId, { type: 'overlay.host.act-plan', payload })

    if (proxied?.ok && proxied.payload) return proxied.payload
    if (proxied?.error) throw new Error(proxied.error)
    if (typeof proxied?.status === 'number') {
      throw new Error(`Remote act planner failed (${proxied.status}).`)
    }
  }

  throw new Error(
    hasBearer
      ? `Could not reach ${args.preferences.baseUrl}. Check your network and try again.`
      : `Sign in to Overlay: open Account settings → Connect and complete sign-in in the browser (no tab needs to stay open afterward).`,
  )
}

export async function runRemoteBrowserTask(args: {
  preferences: ExtensionPreferences
  session: ExtensionSession | null
  task: string
}): Promise<{
  output?: string
  sessionId?: string
  liveUrl?: string | null
  status?: string
  billing?: unknown
}> {
  const payload = { task: args.task }
  const endpoint = '/api/v1/browser-task'
  const hasBearer = Boolean(args.session?.accessToken?.trim() && args.session?.user?.id?.trim())

  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (hasBearer && args.session?.accessToken) {
    headers.Authorization = `Bearer ${args.session.accessToken}`
  }

  let response: Response | null = null
  try {
    response = await fetch(joinUrl(args.preferences.baseUrl, endpoint), {
      method: 'POST',
      credentials: hasBearer ? 'omit' : 'include',
      headers,
      body: JSON.stringify(payload),
    })
  } catch {
    response = null
  }

  if (response?.ok) {
    return parseJsonResponse<{
      output?: string
      sessionId?: string
      liveUrl?: string | null
      status?: string
      billing?: unknown
    }>(response)
  }

  if (response && hasBearer) {
    const err = (await response.json().catch(() => ({}))) as { message?: string; error?: string }
    throw new Error(
      response.status === 401
        ? 'Session expired or not signed in. Open the extension sidebar → Account settings → Connect.'
        : err.message || err.error || `Remote browser task failed (${response.status}).`,
    )
  }

  const hostTabId = await findHostTab(args.preferences.baseUrl)
  if (hostTabId) {
    const proxied = await sendHostTabMessage<{
      ok?: boolean
      status?: number
      payload?: {
        output?: string
        sessionId?: string
        liveUrl?: string | null
        status?: string
        billing?: unknown
      }
      error?: string
    }>(hostTabId, { type: 'overlay.host.browser-task', payload })

    if (proxied?.ok && proxied.payload) return proxied.payload
    if (proxied?.error) throw new Error(proxied.error)
    if (typeof proxied?.status === 'number') {
      throw new Error(`Remote browser task failed (${proxied.status}).`)
    }
  }

  throw new Error(
    hasBearer
      ? `Could not reach ${args.preferences.baseUrl}. Check your network and try again.`
      : `Sign in to Overlay: open Account settings → Connect and complete sign-in in the browser.`,
  )
}

export async function streamRemoteChatTurn(args: {
  baseUrl: string
  session: ExtensionSession
  conversationId: string
  turnId: string
  prompt: string
  systemPrompt?: string
  modelId: string
  variantIndex: number
  variantTotal: number
  attachments?: Array<{ kind: string; name: string; mimeType: string; dataUrl?: string; documentId?: string; status?: string }>
  signal?: AbortSignal
  onChunk: (chunk: Record<string, unknown>) => Promise<void> | void
}): Promise<void> {
  const userParts: Array<Record<string, unknown>> = [{ type: 'text', text: args.prompt }]
  const indexedFileNames: string[] = []
  const attachmentNames: string[] = []
  for (const attachment of args.attachments ?? []) {
    attachmentNames.push(attachment.name)
    if (attachment.kind === 'image' && attachment.dataUrl) {
      userParts.push({ type: 'file', url: attachment.dataUrl, mediaType: attachment.mimeType })
    }
    if (attachment.kind === 'document' && attachment.status === 'ready') {
      indexedFileNames.push(attachment.name)
    }
  }
  const message = {
    id: args.turnId,
    role: 'user',
    parts: userParts,
  }
  const response = await fetch(joinUrl(args.baseUrl, '/api/v1/conversations/act'), {
    method: 'POST',
    headers: remoteHeaders(args.session),
    credentials: 'omit',
    signal: args.signal,
    body: JSON.stringify({
      messages: [message],
      conversationId: args.conversationId,
      turnId: args.turnId,
      modelId: args.modelId,
      systemPrompt: args.systemPrompt,
      mode: 'chat',
      userId: args.session.user.id,
      multiModelSlotIndex: args.variantIndex,
      multiModelTotal: args.variantTotal,
      ...(indexedFileNames.length > 0 ? { indexedFileNames } : {}),
      ...(attachmentNames.length > 0 ? { attachmentNames } : {}),
    }),
  })
  if (!response.ok || !response.body) {
    const payload = await response.json().catch(() => ({})) as { error?: string; message?: string }
    throw new Error(payload.message || payload.error || `Chat stream failed (${response.status}).`)
  }
  await consumeUiMessageEventStream(response.body, args.onChunk)
}

function listItemsFromArray(items: unknown, mapper: (item: Record<string, unknown>) => BackendListItem | null): BackendListItem[] {
  if (!Array.isArray(items)) return []
  return items
    .map((item) => (item && typeof item === 'object' ? mapper(item as Record<string, unknown>) : null))
    .filter((item): item is BackendListItem => Boolean(item))
}

function compactItem(item: Record<string, unknown>, fallbackKind?: string): BackendListItem | null {
  const id = String(item._id ?? item.id ?? '').trim()
  const title = String(item.title ?? item.name ?? item.label ?? item.fileName ?? '').trim()
  if (!id || !title) return null
  const updatedAtRaw = item.updatedAt ?? item.lastModified ?? item.createdAt
  return {
    id,
    title,
    subtitle: typeof item.description === 'string'
      ? item.description
      : typeof item.kind === 'string'
        ? item.kind
        : undefined,
    href: typeof item.url === 'string' ? item.url : undefined,
    kind: typeof item.kind === 'string' ? item.kind : fallbackKind,
    updatedAt: typeof updatedAtRaw === 'number' ? updatedAtRaw : undefined,
  }
}

export async function fetchRemoteParitySnapshot(args: {
  baseUrl: string
  session: ExtensionSession
}): Promise<BackendParitySnapshot | null> {
  if (!args.session.accessToken?.trim() || !args.session.user?.id?.trim()) return null
  const [projects, files, outputs, memories, automations, skills, mcps, integrations, settings] = await Promise.all([
    remoteGet<unknown>(args.baseUrl, args.session, '/api/v1/projects').catch(() => []),
    remoteGet<unknown>(args.baseUrl, args.session, '/api/v1/files').catch(() => []),
    remoteGet<unknown>(args.baseUrl, args.session, '/api/v1/outputs').catch(() => []),
    remoteGet<unknown>(args.baseUrl, args.session, '/api/v1/memory').catch(() => []),
    remoteGet<unknown>(args.baseUrl, args.session, '/api/v1/automations').catch(() => []),
    remoteGet<unknown>(args.baseUrl, args.session, '/api/v1/skills').catch(() => []),
    remoteGet<unknown>(args.baseUrl, args.session, '/api/v1/mcps').catch(() => []),
    remoteGet<unknown>(args.baseUrl, args.session, '/api/v1/integrations').catch(() => ({ items: [] })),
    remoteGet<Record<string, unknown>>(args.baseUrl, args.session, '/api/v1/settings').catch(() => null),
  ])
  const integrationItems = integrations && typeof integrations === 'object' && 'items' in integrations
    ? (integrations as { items?: unknown }).items
    : integrations
  return {
    projects: listItemsFromArray(projects, (item) => compactItem(item, 'project')),
    files: listItemsFromArray(files, (item) => compactItem(item, typeof item.kind === 'string' ? item.kind : 'file')),
    outputs: listItemsFromArray(outputs, (item) => compactItem(item, 'output')),
    memories: listItemsFromArray(memories, (item) => compactItem(item, 'memory')),
    automations: listItemsFromArray(automations, (item) => compactItem(item, 'automation')),
    skills: listItemsFromArray(skills, (item) => compactItem(item, 'skill')),
    mcps: listItemsFromArray(mcps, (item) => compactItem(item, 'mcp')),
    integrations: listItemsFromArray(integrationItems, (item) => compactItem(item, 'integration')),
    settings,
    fetchedAt: Date.now(),
  }
}

export async function fetchRemoteChatTitle(args: {
  baseUrl: string
  session: ExtensionSession
  text: string
}): Promise<string | null> {
  const userId = args.session.user?.id?.trim()
  if (!userId) return null

  const response = await fetch(joinUrl(args.baseUrl, '/api/v1/generate-title'), {
    method: 'POST',
    headers: remoteHeaders(args.session),
    body: JSON.stringify({
      text: args.text,
      userId,
    }),
  }).catch(() => null)

  if (!response?.ok) return null
  const payload = await response.json().catch(() => ({})) as { title?: string }
  if (typeof payload.title !== 'string' || !payload.title.trim()) return null
  return sanitizeChatTitle(payload.title, 'New Chat')
}

function sanitizeTabGroupLabel(raw: string | null | undefined, fallback: string): string {
  const normalized = (raw || '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^["'`“”]+|["'`“”]+$/g, '')
    .replace(/[.!?,;:]+$/g, '')
    .trim()
  const words = normalized.split(/\s+/).filter(Boolean).slice(0, 3)
  const joined = words.join(' ')
  return joined || fallback
}

export async function fetchRemoteTabGroupLabel(args: {
  baseUrl: string
  session: ExtensionSession
  text: string
}): Promise<string | null> {
  const userId = args.session.user?.id?.trim()
  if (!userId) return null

  const response = await fetch(joinUrl(args.baseUrl, '/api/v1/generate-tab-group-label'), {
    method: 'POST',
    headers: remoteHeaders(args.session),
    body: JSON.stringify({
      text: args.text,
      userId,
    }),
  }).catch(() => null)

  if (!response?.ok) return null
  const payload = await response.json().catch(() => ({})) as { title?: string }
  if (typeof payload.title !== 'string' || !payload.title.trim()) return null
  const words = args.text.trim().split(/\s+/).filter(Boolean).slice(0, 3).join(' ') || 'Overlay'
  return sanitizeTabGroupLabel(payload.title, words)
}

export async function runRemoteGenerateImage(args: {
  baseUrl: string
  session: ExtensionSession
  prompt: string
  modelId: string
  conversationId?: string
  turnId?: string
  /** Optional reference image (data URL) for image-to-image edits. */
  imageUrl?: string
}): Promise<{ url: string; modelUsed?: string; outputId?: string }> {
  const userId = args.session.user?.id?.trim()
  if (!userId) throw new Error('Sign in to generate images.')

  const response = await fetch(joinUrl(args.baseUrl, '/api/v1/generate-image'), {
    method: 'POST',
    headers: remoteHeaders(args.session),
    body: JSON.stringify({
      prompt: args.prompt,
      modelId: args.modelId,
      conversationId: args.conversationId,
      turnId: args.turnId,
      imageUrl: args.imageUrl,
      userId,
    }),
  })

  const payload = await response.json().catch(() => ({})) as {
    url?: string
    modelUsed?: string
    outputId?: string
    message?: string
    error?: string
  }

  if (!response.ok) {
    throw new Error(payload.message || payload.error || `Image generation failed (${response.status}).`)
  }
  if (!payload.url) {
    throw new Error('No image URL returned.')
  }
  return { url: payload.url, modelUsed: payload.modelUsed, outputId: payload.outputId }
}

async function consumeVideoGenerationSse(stream: ReadableStream<Uint8Array>): Promise<{
  url?: string
  modelUsed?: string
  outputId?: string
  error?: string
}> {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let latest: { url?: string; modelUsed?: string; outputId?: string; error?: string } = {}

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })

    while (true) {
      const splitIndex = buffer.indexOf('\n\n')
      if (splitIndex < 0) break
      const block = buffer.slice(0, splitIndex)
      buffer = buffer.slice(splitIndex + 2)

      const dataLine = block
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find((line) => line.startsWith('data:'))
      if (!dataLine) continue
      const json = dataLine.slice(5).trimStart()
      if (!json) continue
      try {
        const data = JSON.parse(json) as Record<string, unknown>
        if (data.type === 'completed' && typeof data.url === 'string') {
          latest = {
            url: data.url,
            modelUsed: typeof data.modelUsed === 'string' ? data.modelUsed : undefined,
            outputId: typeof data.outputId === 'string' ? data.outputId : undefined,
          }
        }
        if (data.type === 'error') {
          latest.error =
            typeof data.message === 'string'
              ? data.message
              : typeof data.error === 'string'
                ? data.error
                : 'Video generation failed.'
        }
        if (data.type === 'failed') {
          latest.error = typeof data.error === 'string' ? data.error : 'Video generation failed.'
        }
      } catch {
        // ignore malformed chunk
      }
    }
  }

  buffer += decoder.decode()
  if (buffer.trim()) {
    const dataLine = buffer
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line.startsWith('data:'))
    if (dataLine) {
      const json = dataLine.slice(5).trimStart()
      try {
        const data = JSON.parse(json) as Record<string, unknown>
        if (data.type === 'completed' && typeof data.url === 'string') {
          latest = {
            url: data.url,
            modelUsed: typeof data.modelUsed === 'string' ? data.modelUsed : undefined,
            outputId: typeof data.outputId === 'string' ? data.outputId : undefined,
          }
        }
      } catch {
        // ignore
      }
    }
  }

  return latest
}

export async function runRemoteGenerateVideo(args: {
  baseUrl: string
  session: ExtensionSession
  prompt: string
  modelId: string
  conversationId?: string
  turnId?: string
}): Promise<{ url: string; modelUsed?: string; outputId?: string }> {
  const userId = args.session.user?.id?.trim()
  if (!userId) throw new Error('Sign in to generate video.')

  const response = await fetch(joinUrl(args.baseUrl, '/api/v1/generate-video'), {
    method: 'POST',
    headers: remoteHeaders(args.session),
    body: JSON.stringify({
      prompt: args.prompt,
      modelId: args.modelId,
      conversationId: args.conversationId,
      turnId: args.turnId,
      userId,
    }),
  })

  if (!response.ok || !response.body) {
    const text = await response.text().catch(() => '')
    throw new Error(text || `Video request failed (${response.status}).`)
  }

  const parsed = await consumeVideoGenerationSse(response.body)
  if (parsed.error) throw new Error(parsed.error)
  if (!parsed.url) throw new Error('No video URL returned.')
  return { url: parsed.url, modelUsed: parsed.modelUsed, outputId: parsed.outputId }
}

/**
 * Fetch the authenticated user's subscription snapshot. Returns null when the
 * user is unauthenticated or the server call fails — callers should treat a
 * null response as "unknown" (UI should not aggressively lock features).
 */
export async function fetchRemoteEntitlements(args: {
  baseUrl: string
  session: ExtensionSession
}): Promise<{
  tier: 'free' | 'pro' | 'max'
  planKind?: 'free' | 'paid'
  creditsUsed?: number
  creditsTotal?: number
} | null> {
  if (!args.session.accessToken?.trim() || !args.session.user?.id?.trim()) return null
  try {
    const response = await fetch(joinUrl(args.baseUrl, '/api/v1/subscription'), {
      method: 'GET',
      headers: createBearerHeaders(args.session),
      credentials: 'include',
    })
    if (!response.ok) return null
    const payload = (await response.json().catch(() => null)) as {
      tier?: 'free' | 'pro' | 'max'
      planKind?: 'free' | 'paid'
      creditsUsed?: number
      creditsTotal?: number
    } | null
    if (!payload?.tier) return null
    return {
      tier: payload.tier,
      planKind: payload.planKind,
      creditsUsed: payload.creditsUsed,
      creditsTotal: payload.creditsTotal,
    }
  } catch {
    return null
  }
}

function base64ToBlob(base64: string, mimeType: string): Blob {
  const binary = atob(base64)
  const buffer = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) buffer[i] = binary.charCodeAt(i)
  return new Blob([buffer], { type: mimeType })
}

/**
 * Upload a document for indexing. Returns the remote documentId plus the
 * indexed file name we should pass back to the Ask payload as
 * `metadata.indexedDocuments`.
 */
export async function ingestRemoteDocument(args: {
  baseUrl: string
  session: ExtensionSession
  fileName: string
  mimeType: string
  base64: string
}): Promise<{ documentId: string; indexedFileName: string }> {
  const userId = args.session.user?.id?.trim()
  if (!userId || !args.session.accessToken?.trim()) {
    throw new Error('Sign in to upload documents.')
  }
  const blob = base64ToBlob(args.base64, args.mimeType)
  const form = new FormData()
  form.append('file', blob, args.fileName)

  const response = await fetch(joinUrl(args.baseUrl, '/api/v1/files/ingest-document'), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${args.session.accessToken}`,
    },
    body: form,
  })

  const payload = (await response.json().catch(() => ({}))) as {
    documentId?: string
    fileName?: string
    error?: string
    message?: string
  }
  if (!response.ok || !payload.documentId) {
    throw new Error(payload.message || payload.error || `Document upload failed (${response.status}).`)
  }
  return {
    documentId: payload.documentId,
    indexedFileName: payload.fileName || args.fileName,
  }
}

/** Transcribe recorded audio to text using the authenticated transcribe endpoint. */
export async function transcribeRemoteAudio(args: {
  baseUrl: string
  session: ExtensionSession
  mimeType: string
  base64: string
}): Promise<{ text: string }> {
  const userId = args.session.user?.id?.trim()
  if (!userId || !args.session.accessToken?.trim()) {
    throw new Error('Sign in to use voice transcription.')
  }
  const blob = base64ToBlob(args.base64, args.mimeType)
  const form = new FormData()
  form.append('audio', blob, `voice.${args.mimeType.split('/')[1] || 'webm'}`)

  const response = await fetch(joinUrl(args.baseUrl, '/api/v1/transcribe'), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${args.session.accessToken}`,
    },
    body: form,
  })
  const payload = (await response.json().catch(() => ({}))) as {
    text?: string
    error?: string
    message?: string
  }
  if (!response.ok) {
    throw new Error(payload.message || payload.error || `Transcription failed (${response.status}).`)
  }
  return { text: typeof payload.text === 'string' ? payload.text : '' }
}
