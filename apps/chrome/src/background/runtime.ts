import {
  type ActApprovalMode,
  type ActiveRunState,
  type ApprovalRequest,
  type AttachmentDraft,
  type EntitlementsSnapshot,
  type BrowserContextEnvelope,
  type BrowserScopeMode,
  activeRunKey,
  type ControlIndicatorState,
  type ConversationMessage,
  type ConversationMessagePart,
  type ExtensionCapabilities,
  type ExtensionPreferences,
  type ExtensionSession,
  DEFAULT_IMAGE_MODEL_ID,
  DEFAULT_MODEL_ID,
  DEFAULT_VIDEO_MODEL_ID,
  type LocalToolName,
  resolveImageModelId,
  resolveVideoModelId,
  type MessageDataPart,
  type MessageFilePart,
  type MessageSourcePart,
  type MessageTextPart,
  type MessageToolPart,
  type PageContextSnapshot,
  type PanelRuntimeState,
  type PublicExtensionSession,
  type RuntimeBootstrap,
  toPublicSession,
  type StoredConversation,
  type ToolHistoryEntry,
  type ToolTargetDescriptor,
  type WindowSnapshot,
  type WindowTabSnapshot,
} from '@overlay/extension-contracts'
import {
  buildBrowserContextPrompt,
  createRemoteConversation,
  deleteRemoteConversation,
  fetchRemoteChatTitle,
  fetchRemoteAppBootstrap,
  fetchRemoteConversationWithMessages,
  fetchRemoteConversations,
  fetchRemoteEntitlements,
  fetchRemoteParitySnapshot,
  fetchRemoteTabGroupLabel,
  ingestRemoteDocument,
  probeRemoteAccount,
  refreshOverlaySession,
  runRemoteActPlanner,
  runRemoteBrowserTask,
  runRemoteGenerateImage,
  runRemoteGenerateVideo,
  streamRemoteChatTurn,
  transcribeRemoteAudio,
  type ActPlannerToolRequest,
} from './overlay-api'
import { emitRuntimeStreamEvent } from './stream-bus'
import {
  getExtensionStorage,
  setActiveConversationId,
  setActiveRunsMap,
  setApprovals,
  setConversationTabGroupsMap,
  setConversations,
  setControlIndicator,
  setEntitlements,
  setPreferences,
  setSession,
  setToolHistory,
} from './storage'
import { normalizeTrustedOverlayBaseUrl } from './trusted-origins'

const DEFAULT_PREFERENCES: ExtensionPreferences = {
  baseUrl: 'https://getoverlay.io',
  modelId: DEFAULT_MODEL_ID,
  imageModelId: DEFAULT_IMAGE_MODEL_ID,
  videoModelId: DEFAULT_VIDEO_MODEL_ID,
}

function mergeStoredPreferences(preferences: ExtensionPreferences | null | undefined): ExtensionPreferences {
  const incoming = preferences ?? {}
  const legacy = incoming as ExtensionPreferences & { actModelId?: string; askModelId?: string }
  const { actModelId: legacyAct, askModelId: legacyAskId, ...restIn } = legacy
  return {
    ...DEFAULT_PREFERENCES,
    ...restIn,
    baseUrl: normalizeTrustedOverlayBaseUrl(restIn.baseUrl),
    modelId:
      restIn.modelId?.trim() ||
      legacyAskId?.trim() ||
      legacyAct?.trim() ||
      DEFAULT_PREFERENCES.modelId,
    imageModelId: restIn.imageModelId?.trim() || DEFAULT_PREFERENCES.imageModelId,
    videoModelId: restIn.videoModelId?.trim() || DEFAULT_PREFERENCES.videoModelId,
  }
}

function resolveAskModelIds(preferences: ExtensionPreferences): string[] {
  const requested = Array.isArray(preferences.askModelIds)
    ? preferences.askModelIds.map((id) => id.trim()).filter(Boolean)
    : []
  const ids = requested.length > 0 ? requested : [preferences.modelId || DEFAULT_MODEL_ID]
  return [...new Set(ids)].slice(0, 4)
}

async function renameConversationTitleFromRemote(args: {
  conversationId: string
  baseUrl: string
  session: ExtensionSession
  sourceText: string
}) {
  const title = await fetchRemoteChatTitle({
    baseUrl: args.baseUrl,
    session: args.session,
    text: args.sourceText,
  })
  if (!title?.trim()) return

  const { conversations, activeConversationId } = await loadNormalizedStorage()
  const next = conversations.map((c) =>
    c.id === args.conversationId ? { ...c, title: title.trim(), updatedAt: Date.now() } : c,
  )
  await setConversations(next)
  const updated = next.find((c) => c.id === args.conversationId)
  if (updated) {
    await emitConversationUpdate(updated, activeConversationId)
  }
}

function createFilePart(url: string, mediaType: string, id = createId('part')): MessageFilePart {
  return { type: 'file', id, url, mediaType }
}

export const CAPABILITIES: ExtensionCapabilities = {
  installed: true,
  version: '0.4.0',
  phase: 'phase-2-4',
  sidePanelEnabled: true,
  scopes: ['active-tab', 'current-window'],
  bridgeOrigins: ['http://localhost:3000', 'https://getoverlay.io', 'https://www.getoverlay.io'],
}

export const PANEL_STATE: PanelRuntimeState = {
  phase: 'phase-2-4',
  sidePanelPath: 'sidepanel.html',
  surfaceStatus: {
    background: 'ready',
    contentScript: 'ready',
    webBridge: 'ready',
  },
}

const actRunControllers = new Map<string, { cancelled: boolean }>()
const chatRunControllers = new Map<string, AbortController>()

function isDefined<T>(value: T | null | undefined): value is T {
  return value != null
}

function createId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function truncate(text: string, max = 120): string {
  const normalized = text.replace(/\s+/g, ' ').trim()
  if (normalized.length <= max) return normalized
  return `${normalized.slice(0, max - 1)}…`
}

function createTextPart(text: string, id = createId('part')): MessageTextPart {
  return {
    type: 'text',
    id,
    text,
  }
}

/** Sidebar preview: prefer readable text; never surface raw tool JSON. */
function getHumanPreviewTextFromMessage(message: ConversationMessage): string {
  const textChunks: string[] = []
  for (const part of message.parts) {
    if (part.type === 'text' || part.type === 'reasoning') {
      const t = part.text.trim()
      if (t) textChunks.push(t)
    }
  }
  if (textChunks.length > 0) {
    return textChunks.join('\n\n').trim()
  }
  if (message.parts.some((p) => p.type === 'tool')) {
    return 'Used browser tools'
  }
  if (message.parts.some((p) => p.type === 'source')) {
    return 'Sources attached'
  }
  return ''
}

function stringifyUnknown(value: unknown): string {
  if (value == null) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  try {
    return JSON.stringify(value)
  } catch {
    return ''
  }
}

function makeConversationPreview(conversation: StoredConversation): string {
  const assistant = [...conversation.messages].reverse().find((message) => message.role === 'assistant')
  if (assistant) {
    const t = getHumanPreviewTextFromMessage(assistant)
    return truncate(t || 'Reply', 110)
  }
  const user = [...conversation.messages].reverse().find((message) => message.role === 'user')
  if (user) {
    const t = getHumanPreviewTextFromMessage(user)
    return truncate(t || 'New conversation', 110)
  }
  return truncate('New conversation', 110)
}

function withUpdatedConversation(
  conversations: StoredConversation[],
  updatedConversation: StoredConversation,
): StoredConversation[] {
  const next = conversations.filter((conversation) => conversation.id !== updatedConversation.id)
  next.unshift(updatedConversation)
  return next.sort((a, b) => b.updatedAt - a.updatedAt)
}

function normalizeConversationPart(raw: unknown): ConversationMessagePart | null {
  if (!raw || typeof raw !== 'object') return null

  const part = raw as Record<string, unknown>

  if (part.type === 'text') {
    return {
      type: 'text',
      id: typeof part.id === 'string' ? part.id : createId('part'),
      text: typeof part.text === 'string' ? part.text : '',
    }
  }

  if (part.type === 'reasoning') {
    return {
      type: 'reasoning',
      id: typeof part.id === 'string' ? part.id : createId('part'),
      text: typeof part.text === 'string' ? part.text : '',
      state: part.state === 'done' ? 'done' : 'streaming',
    }
  }

  if (part.type === 'tool') {
    return {
      type: 'tool',
      id: typeof part.id === 'string' ? part.id : createId('part'),
      toolCallId: typeof part.toolCallId === 'string' ? part.toolCallId : createId('tool-call'),
      toolName: typeof part.toolName === 'string' ? part.toolName : 'tool',
      state: typeof part.state === 'string' ? part.state as MessageToolPart['state'] : 'input-available',
      inputText: typeof part.inputText === 'string' ? part.inputText : undefined,
      input: part.input,
      output: part.output,
      errorText: typeof part.errorText === 'string' ? part.errorText : undefined,
      providerExecuted: typeof part.providerExecuted === 'boolean' ? part.providerExecuted : undefined,
      dynamic: typeof part.dynamic === 'boolean' ? part.dynamic : undefined,
      title: typeof part.title === 'string' ? part.title : undefined,
    }
  }

  if (part.type === 'source') {
    return {
      type: 'source',
      id: typeof part.id === 'string' ? part.id : createId('part'),
      sourceKind: part.sourceKind === 'document' ? 'document' : 'url',
      sourceId: typeof part.sourceId === 'string' ? part.sourceId : createId('source'),
      url: typeof part.url === 'string' ? part.url : undefined,
      title: typeof part.title === 'string' ? part.title : undefined,
      mediaType: typeof part.mediaType === 'string' ? part.mediaType : undefined,
      filename: typeof part.filename === 'string' ? part.filename : undefined,
    }
  }

  if (part.type === 'file') {
    return {
      type: 'file',
      id: typeof part.id === 'string' ? part.id : createId('part'),
      url: typeof part.url === 'string' ? part.url : '',
      mediaType: typeof part.mediaType === 'string' ? part.mediaType : 'application/octet-stream',
    }
  }

  if (part.type === 'data') {
    return {
      type: 'data',
      id: typeof part.id === 'string' ? part.id : createId('part'),
      dataType: typeof part.dataType === 'string' ? part.dataType : 'unknown',
      data: part.data,
      transient: typeof part.transient === 'boolean' ? part.transient : undefined,
    }
  }

  return null
}

function normalizeConversationMessage(raw: unknown): ConversationMessage | null {
  if (!raw || typeof raw !== 'object') return null

  const message = raw as Record<string, unknown>
  const role = message.role === 'assistant' ? 'assistant' : message.role === 'user' ? 'user' : null
  if (!role) return null

  const rawParts = Array.isArray(message.parts)
    ? message.parts.map(normalizeConversationPart).filter(isDefined)
    : null
  const legacyBody = typeof message.body === 'string' ? message.body : ''
  const parts = rawParts && rawParts.length > 0 ? rawParts : legacyBody ? [createTextPart(legacyBody)] : []
  const metadata: Record<string, unknown> | undefined =
    message.metadata && typeof message.metadata === 'object'
      ? { ...(message.metadata as Record<string, unknown>) }
      : typeof message.meta === 'string'
        ? { legacyMeta: message.meta }
        : undefined

  const turnId = typeof message.turnId === 'string' ? message.turnId : undefined
  const variantIndex =
    typeof message.variantIndex === 'number' && Number.isFinite(message.variantIndex)
      ? message.variantIndex
      : undefined
  const modelId = typeof message.modelId === 'string' ? message.modelId : undefined

  return {
    id: typeof message.id === 'string' ? message.id : createId('message'),
    role,
    parts,
    createdAt: typeof message.createdAt === 'number' ? message.createdAt : Date.now(),
    metadata,
    turnId,
    variantIndex,
    modelId,
  }
}

/**
 * v2 → v3 migration: synthesize `turnId` on legacy messages by pairing each
 * user message with the assistant messages that immediately follow it (before
 * the next user message). Variants in v2 are assumed single-variant, so
 * `variantIndex` stays undefined (acts as 0).
 */
export function migrateMessagesToV3(messages: ConversationMessage[]): ConversationMessage[] {
  if (messages.every((msg) => msg.turnId)) return messages
  const result: ConversationMessage[] = []
  let currentTurnId: string | null = null
  for (const msg of messages) {
    if (msg.turnId) {
      result.push(msg)
      currentTurnId = msg.turnId
      continue
    }
    if (msg.role === 'user') {
      currentTurnId = `legacy-${msg.id}`
      result.push({ ...msg, turnId: currentTurnId })
    } else {
      // Assistant without a prior user in this turn: tie to its own id.
      const tid = currentTurnId ?? `legacy-${msg.id}`
      result.push({ ...msg, turnId: tid })
    }
  }
  return result
}

export function normalizeStoredConversation(raw: unknown): StoredConversation | null {
  if (!raw || typeof raw !== 'object') return null

  const conversation = raw as Record<string, unknown>
  const messages = Array.isArray(conversation.messages)
    ? conversation.messages.map(normalizeConversationMessage).filter(isDefined)
    : []

  const migratedMessages = migrateMessagesToV3(messages)
  const browserScope = ((): StoredConversation['browserScope'] => {
    const v = conversation.browserScope
    return v === 'active-tab' || v === 'current-window' || v === 'all-windows' ? v : undefined
  })()
  const actApprovalMode = ((): StoredConversation['actApprovalMode'] => {
    const v = conversation.actApprovalMode
    return v === 'ask' || v === 'auto' ? v : undefined
  })()
  const actAllowlist = Array.isArray(conversation.actAllowlist)
    ? (conversation.actAllowlist.filter((v) => typeof v === 'string') as StoredConversation['actAllowlist'])
    : undefined

  const normalized: StoredConversation = {
    id: typeof conversation.id === 'string' ? conversation.id : createId('conversation'),
    title: typeof conversation.title === 'string' ? conversation.title : 'New Chat',
    preview: typeof conversation.preview === 'string' ? conversation.preview : '',
    updatedAt: typeof conversation.updatedAt === 'number' ? conversation.updatedAt : Date.now(),
    messages: migratedMessages,
    version: 3,
    browserScope,
    actApprovalMode,
    actAllowlist,
  }

  normalized.preview = normalized.preview || makeConversationPreview(normalized)
  return normalized
}

async function loadNormalizedStorage() {
  const storage = await getExtensionStorage()
  const conversations = storage.conversations
    .map(normalizeStoredConversation)
    .filter(isDefined)

  const needsMigration =
    conversations.length !== storage.conversations.length ||
    conversations.some((conversation) => conversation.version !== 3)

  if (needsMigration) {
    await setConversations(conversations)
  }

  return {
    ...storage,
    conversations,
  }
}

async function setRunForConversation(
  conversationId: string,
  run: ActiveRunState | null,
  variantIndex?: number,
): Promise<void> {
  const { activeRuns } = await loadNormalizedStorage()
  const next = { ...activeRuns }
  const key = activeRunKey(conversationId, variantIndex ?? run?.variantIndex)
  if (run === null) {
    delete next[key]
  } else {
    next[key] = run
  }
  await setActiveRunsMap(next)
}

function findRunByRunId(
  activeRuns: Record<string, ActiveRunState>,
  runId: string,
): { conversationId: string; run: ActiveRunState } | null {
  for (const [conversationId, run] of Object.entries(activeRuns)) {
    if (run.id === runId) return { conversationId, run }
  }
  return null
}

function createTextMessage(
  role: 'user' | 'assistant',
  text: string,
  createdAt: number,
  metadata?: Record<string, unknown>,
): ConversationMessage {
  return {
    id: createId('message'),
    role,
    parts: text ? [createTextPart(text)] : [],
    createdAt,
    metadata,
  }
}

function updateConversationMessage(
  conversation: StoredConversation,
  messageId: string,
  updater: (message: ConversationMessage) => ConversationMessage,
): StoredConversation {
  return {
    ...conversation,
    messages: conversation.messages.map((message) => (
      message.id === messageId ? updater(message) : message
    )),
  }
}

function upsertToolPart(parts: ConversationMessagePart[], nextPart: MessageToolPart): ConversationMessagePart[] {
  const index = parts.findIndex((part) => part.type === 'tool' && part.toolCallId === nextPart.toolCallId)
  if (index >= 0) {
    const next = [...parts]
    next[index] = { ...(next[index] as MessageToolPart), ...nextPart }
    return next
  }
  return [...parts, nextPart]
}

function upsertTextPart(parts: ConversationMessagePart[], partId: string): ConversationMessagePart[] {
  if (parts.some((part) => part.type === 'text' && part.id === partId)) return parts
  return [...parts, { type: 'text', id: partId, text: '' }]
}

function upsertReasoningPart(parts: ConversationMessagePart[], partId: string): ConversationMessagePart[] {
  if (parts.some((part) => part.type === 'reasoning' && part.id === partId)) return parts
  return [...parts, { type: 'reasoning', id: partId, text: '', state: 'streaming' }]
}

export function applyAskChunkToMessage(message: ConversationMessage, chunk: Record<string, unknown>): ConversationMessage {
  let parts = [...message.parts]
  let metadata = message.metadata ? { ...message.metadata } : undefined

  switch (chunk.type) {
    case 'start':
      metadata = {
        ...(metadata ?? {}),
        ...(chunk.messageMetadata && typeof chunk.messageMetadata === 'object'
          ? chunk.messageMetadata as Record<string, unknown>
          : {}),
      }
      break

    case 'message-metadata':
      metadata = {
        ...(metadata ?? {}),
        ...(chunk.messageMetadata && typeof chunk.messageMetadata === 'object'
          ? chunk.messageMetadata as Record<string, unknown>
          : {}),
      }
      break

    case 'finish':
      metadata = {
        ...(metadata ?? {}),
        finishReason: typeof chunk.finishReason === 'string' ? chunk.finishReason : undefined,
        ...(chunk.messageMetadata && typeof chunk.messageMetadata === 'object'
          ? chunk.messageMetadata as Record<string, unknown>
          : {}),
      }
      break

    case 'text-start': {
      const partId = typeof chunk.id === 'string' ? chunk.id : createId('part')
      parts = upsertTextPart(parts, partId)
      break
    }

    case 'text-delta': {
      const partId = typeof chunk.id === 'string' ? chunk.id : ''
      parts = parts.map((part) => (
        part.type === 'text' && part.id === partId
          ? { ...part, text: part.text + (typeof chunk.delta === 'string' ? chunk.delta : '') }
          : part
      ))
      break
    }

    case 'reasoning-start': {
      const partId = typeof chunk.id === 'string' ? chunk.id : createId('part')
      parts = upsertReasoningPart(parts, partId)
      break
    }

    case 'reasoning-delta': {
      const partId = typeof chunk.id === 'string' ? chunk.id : ''
      parts = parts.map((part) => (
        part.type === 'reasoning' && part.id === partId
          ? { ...part, text: part.text + (typeof chunk.delta === 'string' ? chunk.delta : ''), state: 'streaming' }
          : part
      ))
      break
    }

    case 'reasoning-end': {
      const partId = typeof chunk.id === 'string' ? chunk.id : ''
      parts = parts.map((part) => (
        part.type === 'reasoning' && part.id === partId
          ? { ...part, state: 'done' }
          : part
      ))
      break
    }

    case 'tool-input-start':
      parts = upsertToolPart(parts, {
        type: 'tool',
        id: typeof chunk.toolCallId === 'string' ? chunk.toolCallId : createId('part'),
        toolCallId: typeof chunk.toolCallId === 'string' ? chunk.toolCallId : createId('tool-call'),
        toolName: typeof chunk.toolName === 'string' ? chunk.toolName : 'tool',
        state: 'input-streaming',
        inputText: '',
        providerExecuted: typeof chunk.providerExecuted === 'boolean' ? chunk.providerExecuted : undefined,
        dynamic: typeof chunk.dynamic === 'boolean' ? chunk.dynamic : undefined,
        title: typeof chunk.title === 'string' ? chunk.title : undefined,
      })
      break

    case 'tool-input-delta':
      parts = parts.map((part) => (
        part.type === 'tool' && part.toolCallId === chunk.toolCallId
          ? { ...part, inputText: `${part.inputText || ''}${typeof chunk.inputTextDelta === 'string' ? chunk.inputTextDelta : ''}` }
          : part
      ))
      break

    case 'tool-input-available':
      parts = upsertToolPart(parts, {
        type: 'tool',
        id: typeof chunk.toolCallId === 'string' ? chunk.toolCallId : createId('part'),
        toolCallId: typeof chunk.toolCallId === 'string' ? chunk.toolCallId : createId('tool-call'),
        toolName: typeof chunk.toolName === 'string' ? chunk.toolName : 'tool',
        state: 'input-available',
        input: chunk.input,
        providerExecuted: typeof chunk.providerExecuted === 'boolean' ? chunk.providerExecuted : undefined,
        dynamic: typeof chunk.dynamic === 'boolean' ? chunk.dynamic : undefined,
        title: typeof chunk.title === 'string' ? chunk.title : undefined,
      })
      break

    case 'tool-input-error':
      parts = upsertToolPart(parts, {
        type: 'tool',
        id: typeof chunk.toolCallId === 'string' ? chunk.toolCallId : createId('part'),
        toolCallId: typeof chunk.toolCallId === 'string' ? chunk.toolCallId : createId('tool-call'),
        toolName: typeof chunk.toolName === 'string' ? chunk.toolName : 'tool',
        state: 'input-error',
        input: chunk.input,
        errorText: typeof chunk.errorText === 'string' ? chunk.errorText : 'Tool input failed.',
        providerExecuted: typeof chunk.providerExecuted === 'boolean' ? chunk.providerExecuted : undefined,
        dynamic: typeof chunk.dynamic === 'boolean' ? chunk.dynamic : undefined,
        title: typeof chunk.title === 'string' ? chunk.title : undefined,
      })
      break

    case 'tool-output-available':
      parts = parts.map((part) => (
        part.type === 'tool' && part.toolCallId === chunk.toolCallId
          ? { ...part, output: chunk.output, state: 'output-available' }
          : part
      ))
      break

    case 'tool-output-error':
      parts = parts.map((part) => (
        part.type === 'tool' && part.toolCallId === chunk.toolCallId
          ? {
              ...part,
              state: 'output-error',
              errorText: typeof chunk.errorText === 'string' ? chunk.errorText : 'Tool execution failed.',
            }
          : part
      ))
      break

    case 'tool-output-denied':
      parts = parts.map((part) => (
        part.type === 'tool' && part.toolCallId === chunk.toolCallId
          ? { ...part, state: 'output-denied' }
          : part
      ))
      break

    case 'source-url':
      parts = [
        ...parts,
        {
          type: 'source',
          id: createId('part'),
          sourceKind: 'url',
          sourceId: typeof chunk.sourceId === 'string' ? chunk.sourceId : createId('source'),
          url: typeof chunk.url === 'string' ? chunk.url : undefined,
          title: typeof chunk.title === 'string' ? chunk.title : undefined,
        } satisfies MessageSourcePart,
      ]
      break

    case 'source-document':
      parts = [
        ...parts,
        {
          type: 'source',
          id: createId('part'),
          sourceKind: 'document',
          sourceId: typeof chunk.sourceId === 'string' ? chunk.sourceId : createId('source'),
          title: typeof chunk.title === 'string' ? chunk.title : undefined,
          mediaType: typeof chunk.mediaType === 'string' ? chunk.mediaType : undefined,
          filename: typeof chunk.filename === 'string' ? chunk.filename : undefined,
        } satisfies MessageSourcePart,
      ]
      break

    case 'file':
      parts = [
        ...parts,
        {
          type: 'file',
          id: createId('part'),
          url: typeof chunk.url === 'string' ? chunk.url : '',
          mediaType: typeof chunk.mediaType === 'string' ? chunk.mediaType : 'application/octet-stream',
        } satisfies MessageFilePart,
      ]
      break

    case 'error':
      parts = parts.length > 0 ? parts : [createTextPart(typeof chunk.errorText === 'string' ? chunk.errorText : 'An error occurred.')]
      metadata = {
        ...(metadata ?? {}),
        streamError: typeof chunk.errorText === 'string' ? chunk.errorText : 'An error occurred.',
      }
      break

    default:
      if (typeof chunk.type === 'string' && chunk.type.startsWith('data-')) {
        parts = [
          ...parts,
          {
            type: 'data',
            id: typeof chunk.id === 'string' ? chunk.id : createId('part'),
            dataType: chunk.type.slice(5),
            data: chunk.data,
            transient: typeof chunk.transient === 'boolean' ? chunk.transient : undefined,
          } satisfies MessageDataPart,
        ]
      }
      break
  }

  return {
    ...message,
    parts,
    metadata,
  }
}

async function resolveDefaultBaseUrl(preferences: ExtensionPreferences | null): Promise<string> {
  if (preferences?.baseUrl?.trim()) return normalizeTrustedOverlayBaseUrl(preferences.baseUrl)

  const tabs = await chrome.tabs.query({ currentWindow: true })
  const preferredTab = tabs.find((tab) => tab.url?.startsWith('http://localhost:3000'))
    ?? tabs.find((tab) => tab.url?.startsWith('https://getoverlay.io'))
    ?? tabs.find((tab) => tab.url?.startsWith('https://www.getoverlay.io'))

  if (preferredTab?.url) {
    try {
      return new URL(preferredTab.url).origin
    } catch {
      return DEFAULT_PREFERENCES.baseUrl
    }
  }

  return DEFAULT_PREFERENCES.baseUrl
}

export async function getActiveTabId(): Promise<number | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  return tab?.id
}

export async function captureActivePageContext(): Promise<PageContextSnapshot | null> {
  const tabId = await getActiveTabId()
  if (!tabId) return null
  return capturePageContextForTab(tabId)
}

/** Page context for the tab that sent the message (Ask/Act), not whichever tab is focused when the worker runs. */
export async function capturePageContextForTab(tabId: number): Promise<PageContextSnapshot | null> {
  try {
    const response = await chrome.tabs.sendMessage(tabId, { type: 'overlay.page-context.capture' })
    const snapshot = (response as { snapshot?: PageContextSnapshot } | undefined)?.snapshot ?? null
    return snapshot ? { ...snapshot, tabId } : null
  } catch {
    return null
  }
}

/**
 * Places the source tab in a Chrome tab group for this conversation (MV3: chrome.tabs.group).
 * Titles are applied separately via chrome.tabGroups.update (requires "tabGroups" permission).
 */
async function ensureConversationTabGroupMetadata(args: {
  conversationId: string
  sourceTabId: number
}): Promise<number | null> {
  const tab = await chrome.tabs.get(args.sourceTabId).catch(() => null)
  if (!tab?.id || tab.id !== args.sourceTabId) return null
  const url = tab.url?.trim() ?? ''
  if (!url || (!url.startsWith('http://') && !url.startsWith('https://'))) return null

  const windowId = tab.windowId
  const storage = await getExtensionStorage()
  let groupsMap = { ...storage.conversationTabGroups }
  const existingGroupId = groupsMap[args.conversationId]

  const persist = async (groupId: number) => {
    groupsMap = { ...groupsMap, [args.conversationId]: groupId }
    await setConversationTabGroupsMap(groupsMap)
    return groupId
  }

  try {
    if (existingGroupId != null) {
      try {
        await chrome.tabs.group({ tabIds: [args.sourceTabId], groupId: existingGroupId })
        return existingGroupId
      } catch {
        const groupId = await chrome.tabs.group({
          tabIds: [args.sourceTabId],
          createProperties: { windowId },
        })
        return persist(groupId)
      }
    }
    const groupId = await chrome.tabs.group({
      tabIds: [args.sourceTabId],
      createProperties: { windowId },
    })
    return persist(groupId)
  } catch {
    return null
  }
}

function scheduleTabGroupLabelUpdate(args: {
  groupId: number
  labelSourceText: string
  baseUrl: string
  session: ExtensionSession | null
}): void {
  void (async () => {
    try {
      const session = args.session
      if (!session?.accessToken?.trim() || !session.user?.id?.trim()) return
      const title = await fetchRemoteTabGroupLabel({
        baseUrl: args.baseUrl,
        session,
        text: args.labelSourceText,
      })
      if (!title?.trim()) return
      await chrome.tabGroups.update(args.groupId, { title: title.trim() }).catch(() => {})
    } catch {
      // ignore
    }
  })()
}

export async function captureCurrentWindowTabs(): Promise<WindowTabSnapshot[]> {
  const tabs = await chrome.tabs.query({ currentWindow: true })
  return tabs
    .filter((tab): tab is chrome.tabs.Tab & { id: number } => typeof tab.id === 'number')
    .map((tab) => ({
      tabId: tab.id,
      title: tab.title?.trim() || 'Untitled tab',
      url: tab.url?.trim() || '',
      active: Boolean(tab.active),
      status: tab.status || 'unknown',
    }))
}

export async function captureAllWindows(): Promise<WindowSnapshot[]> {
  const windows = await chrome.windows.getAll({ populate: true })
  return windows
    .filter((window): window is chrome.windows.Window & { id: number } => typeof window.id === 'number')
    .map((window) => ({
      windowId: window.id,
      focused: Boolean(window.focused),
      tabCount: window.tabs?.length ?? 0,
    }))
}

async function emitConversationUpdate(conversation: StoredConversation, activeConversationId: string | null) {
  emitRuntimeStreamEvent({
    type: 'overlay.runtime.stream.conversation.updated',
    conversation,
    activeConversationId,
  })
}

async function emitRunUpdate(
  conversationId: string,
  run: ActiveRunState | null,
  variantIndex?: number,
) {
  emitRuntimeStreamEvent({
    type: 'overlay.runtime.stream.run.updated',
    conversationId,
    variantIndex: variantIndex ?? run?.variantIndex,
    run,
  })
}

async function emitApprovalsUpdate(approvals: ApprovalRequest[]) {
  emitRuntimeStreamEvent({
    type: 'overlay.runtime.stream.approvals.updated',
    approvals,
  })
}

async function emitControlUpdate(controlIndicator: ControlIndicatorState | null) {
  emitRuntimeStreamEvent({
    type: 'overlay.runtime.stream.control.updated',
    controlIndicator,
  })
}

export async function bootstrapRuntime(): Promise<RuntimeBootstrap> {
  const [storage, pageContext, windowTabs] = await Promise.all([
    loadNormalizedStorage(),
    captureActivePageContext(),
    captureCurrentWindowTabs(),
  ])
  const { session, activeConversationId, approvals, toolHistory, preferences, activeRuns, controlIndicator } = storage

  const resolvedPreferences: ExtensionPreferences = {
    ...mergeStoredPreferences(preferences),
    baseUrl: await resolveDefaultBaseUrl(preferences),
  }
  const probedUser = await probeRemoteAccount(resolvedPreferences.baseUrl).catch(() => null)
  const resolvedSession = session ?? (probedUser?.email ? {
    status: 'connected' as const,
    baseUrl: resolvedPreferences.baseUrl,
    accessToken: '',
    user: {
      email: probedUser.email,
      firstName: probedUser.firstName,
      lastName: probedUser.lastName,
    },
    refreshError: null,
  } : null)

  let conversations = storage.conversations
  let entitlements = storage.entitlements
  let parity = null
  if (session?.accessToken?.trim() && session.user?.id?.trim()) {
    const [remoteBootstrap, remoteConversations, remoteParity] = await Promise.all([
      fetchRemoteAppBootstrap({ baseUrl: resolvedPreferences.baseUrl, session }).catch(() => null),
      fetchRemoteConversations({
        baseUrl: resolvedPreferences.baseUrl,
        session,
        activeConversationId: activeConversationId ?? storage.conversations[0]?.id ?? null,
      }).catch(() => null),
      fetchRemoteParitySnapshot({ baseUrl: resolvedPreferences.baseUrl, session }).catch(() => null),
    ])
    if (remoteConversations) {
      conversations = remoteConversations
      await setConversations(remoteConversations)
    }
    if (remoteBootstrap?.entitlements?.tier) {
      entitlements = {
        tier: remoteBootstrap.entitlements.tier,
        planKind: remoteBootstrap.entitlements.planKind,
        isPaid:
          remoteBootstrap.entitlements.planKind === 'paid' ||
          remoteBootstrap.entitlements.tier === 'pro' ||
          remoteBootstrap.entitlements.tier === 'max',
        creditsUsed: remoteBootstrap.entitlements.creditsUsed,
        creditsTotal: remoteBootstrap.entitlements.creditsTotal,
        fetchedAt: Date.now(),
      }
      await setEntitlements(entitlements)
    }
    parity = remoteParity
  }

  return {
    capabilities: CAPABILITIES,
    panelState: PANEL_STATE,
    session: toPublicSession(resolvedSession),
    preferences: resolvedPreferences,
    conversations,
    activeConversationId: activeConversationId ?? conversations[0]?.id ?? null,
    pageContext,
    windowTabs,
    approvals,
    toolHistory,
    activeRuns,
    controlIndicator,
    entitlements,
    parity,
  }
}

export async function createConversation(): Promise<StoredConversation> {
  const storage = await loadNormalizedStorage()
  const resolvedPreferences: ExtensionPreferences = {
    ...mergeStoredPreferences(storage.preferences),
    baseUrl: await resolveDefaultBaseUrl(storage.preferences),
  }
  const conversation: StoredConversation =
    storage.session?.accessToken?.trim() && storage.session.user?.id?.trim()
      ? await createRemoteConversation({
          baseUrl: resolvedPreferences.baseUrl,
          session: storage.session,
          title: 'New Chat',
          askModelIds: resolveAskModelIds(resolvedPreferences),
          actModelId: resolvedPreferences.modelId,
        })
      : {
          id: createId('conversation'),
          title: 'New Chat',
          preview: 'Ask about the current page or the tabs in this window.',
          updatedAt: Date.now(),
          messages: [],
          version: 3,
        }
  await setConversations(withUpdatedConversation(storage.conversations, conversation))
  await setActiveConversationId(conversation.id)
  return conversation
}

export async function deleteConversation(conversationId: string) {
  const storage = await loadNormalizedStorage()
  const { conversations, activeConversationId, activeRuns } = storage
  if (storage.session?.accessToken?.trim() && storage.session.user?.id?.trim()) {
    const baseUrl = await resolveDefaultBaseUrl(storage.preferences)
    await deleteRemoteConversation({ baseUrl, session: storage.session, conversationId }).catch(() => {})
  }
  const next = conversations.filter((conversation) => conversation.id !== conversationId)
  await setConversations(next)
  if (activeConversationId === conversationId) {
    await setActiveConversationId(next[0]?.id ?? null)
  }
  if (activeRuns[conversationId]) {
    await stopActRun(conversationId)
  }
  const rawStorage = await getExtensionStorage()
  const nextGroups = { ...rawStorage.conversationTabGroups }
  delete nextGroups[conversationId]
  await setConversationTabGroupsMap(nextGroups)
}

export async function selectConversation(conversationId: string) {
  const storage = await loadNormalizedStorage()
  const { activeConversationId: prevId, conversations } = storage
  // When leaving a conversation, wipe its ephemeral Act allowlist so the next
  // time the user revisits it they are prompted for destructive tools again.
  // Allowlist decisions via `approve-allowlist` are intentionally short-lived.
  if (prevId && prevId !== conversationId) {
    const prev = conversations.find((c) => c.id === prevId)
    if (prev && Array.isArray(prev.actAllowlist) && prev.actAllowlist.length > 0) {
      const cleared: StoredConversation = {
        ...prev,
        actAllowlist: [],
        updatedAt: Date.now(),
      }
      await setConversations(updateConversation(conversations, prevId, () => cleared))
    }
  }
  await setActiveConversationId(conversationId)
  if (storage.session?.accessToken?.trim() && storage.session.user?.id?.trim()) {
    const baseUrl = await resolveDefaultBaseUrl(storage.preferences)
    const remote = await fetchRemoteConversationWithMessages({
      baseUrl,
      session: storage.session,
      conversationId,
    }).catch(() => null)
    if (remote) {
      await setConversations(withUpdatedConversation(conversations, remote))
      await emitConversationUpdate(remote, conversationId)
    }
  }
}

/**
 * Persists per-conversation scope / approval-mode settings. Used by the
 * BrowserScopeBar and ActApprovalModeMenu in the side panel. Returns the
 * updated conversation so the caller can refresh local state without a full
 * bootstrap reload.
 */
export async function saveConversationSettings(
  conversationId: string,
  settings: { browserScope?: BrowserScopeMode; actApprovalMode?: ActApprovalMode },
): Promise<StoredConversation> {
  const { conversations } = await loadNormalizedStorage()
  const target = conversations.find((c) => c.id === conversationId)
  if (!target) throw new Error('Conversation not found.')
  const next: StoredConversation = {
    ...target,
    browserScope: settings.browserScope ?? target.browserScope,
    actApprovalMode: settings.actApprovalMode ?? target.actApprovalMode,
    updatedAt: Date.now(),
  }
  await persistConversationState(
    updateConversation(conversations, conversationId, () => next),
    conversationId,
    conversationId,
  )
  return next
}

export async function saveSessionState(session: ExtensionSession): Promise<PublicExtensionSession> {
  const sanitized: ExtensionSession = {
    ...session,
    baseUrl: normalizeTrustedOverlayBaseUrl(session.baseUrl),
    status: 'connected',
    lastValidatedAt: session.lastValidatedAt ?? Date.now(),
    refreshError: null,
  }
  await setSession(sanitized)
  return toPublicSession(sanitized)!
}

export async function clearSessionState() {
  await setSession(null)
}

export async function savePreferencesState(preferences: ExtensionPreferences) {
  const next = mergeStoredPreferences(preferences)
  await setPreferences(next)
  return next
}

export async function refreshSessionState(): Promise<PublicExtensionSession> {
  const { session } = await loadNormalizedStorage()
  if (!session) {
    throw new Error('No saved session is available.')
  }

  const refreshingSession: ExtensionSession = {
    ...session,
    status: 'refreshing',
    refreshError: null,
  }
  await setSession(refreshingSession)

  try {
    const refreshed = await refreshOverlaySession(session)
    await setSession(refreshed)
    return toPublicSession(refreshed)!
  } catch (error) {
    const failed: ExtensionSession = {
      ...session,
      status: 'connected',
      refreshError: error instanceof Error ? error.message : 'Failed to refresh session.',
    }
    await setSession(failed)
    throw error
  }
}

export async function startMediaGeneration(params: {
  conversationId: string
  prompt: string
  kind: 'image' | 'video'
  attachments?: AttachmentDraft[]
}): Promise<void> {
  const storage = await loadNormalizedStorage()
  const hasLive = Object.keys(storage.activeRuns).some(
    (key) => key === params.conversationId || key.startsWith(`${params.conversationId}#`),
  )
  if (hasLive) {
    throw new Error('Wait for the current run to finish in this conversation.')
  }
  const session = storage.session
  if (!session?.accessToken?.trim() || !session.user?.id?.trim()) {
    throw new Error('Sign in on Overlay to generate images and video.')
  }

  const resolvedPreferences: ExtensionPreferences = {
    ...mergeStoredPreferences(storage.preferences),
    baseUrl: await resolveDefaultBaseUrl(storage.preferences),
  }

  let conversation = storage.conversations.find((item) => item.id === params.conversationId)
  if (!conversation) {
    conversation = {
      id: params.conversationId,
      title: 'New Chat',
      preview: '',
      updatedAt: Date.now(),
      messages: [],
      version: 2,
    }
  }

  const isFirstExchange = conversation.messages.length === 0
  const createdAt = Date.now()
  const userMessage = createTextMessage('user', params.prompt, createdAt)
  const assistantMessageId = createId('message')
  const assistantMessage: ConversationMessage = {
    id: assistantMessageId,
    role: 'assistant',
    parts: [createTextPart(params.kind === 'image' ? 'Generating image…' : 'Generating video…')],
    createdAt: createdAt + 1,
    metadata: {
      statusLabel: params.kind === 'image' ? 'Generating image' : 'Generating video',
    },
  }

  let updatedConversation: StoredConversation = {
    ...conversation,
    title: isFirstExchange ? truncate(params.prompt, 42) || conversation.title : conversation.title,
    messages: [...conversation.messages, userMessage, assistantMessage],
    updatedAt: assistantMessage.createdAt,
    preview: '',
    version: 2,
  }
  updatedConversation.preview = makeConversationPreview(updatedConversation)

  let nextConversations = withUpdatedConversation(storage.conversations, updatedConversation)
  await setConversations(nextConversations)
  await setActiveConversationId(updatedConversation.id)
  await emitConversationUpdate(updatedConversation, updatedConversation.id)

  const turnId = userMessage.id

  try {
    if (params.kind === 'image') {
      const modelId = resolveImageModelId(resolvedPreferences)
      const imageAttachment = (params.attachments ?? []).find(
        (attachment) => attachment.kind === 'image' && attachment.dataUrl,
      )
      const result = await runRemoteGenerateImage({
        baseUrl: resolvedPreferences.baseUrl,
        session,
        prompt: params.prompt,
        modelId,
        conversationId: params.conversationId,
        turnId,
        imageUrl: imageAttachment?.dataUrl,
      })
      updatedConversation = updateConversationMessage(updatedConversation, assistantMessageId, () => ({
        id: assistantMessageId,
        role: 'assistant',
        createdAt: assistantMessage.createdAt,
        parts: [
          createTextPart(`Generated with ${result.modelUsed ?? modelId}.`),
          createFilePart(result.url, 'image/png'),
        ],
        metadata: {},
      }))
    } else {
      const modelId = resolveVideoModelId(resolvedPreferences)
      const result = await runRemoteGenerateVideo({
        baseUrl: resolvedPreferences.baseUrl,
        session,
        prompt: params.prompt,
        modelId,
        conversationId: params.conversationId,
        turnId,
      })
      updatedConversation = updateConversationMessage(updatedConversation, assistantMessageId, () => ({
        id: assistantMessageId,
        role: 'assistant',
        createdAt: assistantMessage.createdAt,
        parts: [
          createTextPart(`Generated with ${result.modelUsed ?? modelId}.`),
          createFilePart(result.url, 'video/mp4'),
        ],
        metadata: {},
      }))
    }

    updatedConversation = {
      ...updatedConversation,
      updatedAt: Date.now(),
      preview: makeConversationPreview(updatedConversation),
    }
    nextConversations = withUpdatedConversation(nextConversations, updatedConversation)
    await setConversations(nextConversations)
    await emitConversationUpdate(updatedConversation, updatedConversation.id)

    if (isFirstExchange) {
      void renameConversationTitleFromRemote({
        conversationId: updatedConversation.id,
        baseUrl: resolvedPreferences.baseUrl,
        session,
        sourceText: params.prompt,
      }).catch(() => {})
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Generation failed.'
    updatedConversation = updateConversationMessage(updatedConversation, assistantMessageId, () => ({
      id: assistantMessageId,
      role: 'assistant',
      createdAt: assistantMessage.createdAt,
      parts: [createTextPart(message)],
      metadata: {
        ...(assistantMessage.metadata ?? {}),
        streamError: message,
      },
    }))
    updatedConversation = {
      ...updatedConversation,
      updatedAt: Date.now(),
      preview: makeConversationPreview(updatedConversation),
    }
    nextConversations = withUpdatedConversation(nextConversations, updatedConversation)
    await setConversations(nextConversations)
    await emitConversationUpdate(updatedConversation, updatedConversation.id)
    emitRuntimeStreamEvent({
      type: 'overlay.runtime.stream.error',
      error: message,
    })
  }
}

function updateConversation(
  conversations: StoredConversation[],
  conversationId: string,
  updater: (conversation: StoredConversation) => StoredConversation,
): StoredConversation[] {
  const existing = conversations.find((conversation) => conversation.id === conversationId)
  if (!existing) return conversations
  return withUpdatedConversation(conversations, updater(existing))
}

function appendAssistantText(
  conversation: StoredConversation,
  messageId: string,
  text: string,
  metadata?: Record<string, unknown>,
): StoredConversation {
  if (!text.trim() && !metadata) return conversation
  return updateConversationMessage(conversation, messageId, (message) => ({
    ...message,
    parts: text.trim()
      ? [...message.parts, createTextPart(text.trim())]
      : message.parts,
    metadata: metadata ? { ...(message.metadata ?? {}), ...metadata } : message.metadata,
  }))
}

function upsertAssistantTool(
  conversation: StoredConversation,
  messageId: string,
  part: MessageToolPart,
  metadata?: Record<string, unknown>,
): StoredConversation {
  return updateConversationMessage(conversation, messageId, (message) => ({
    ...message,
    parts: upsertToolPart(message.parts, part),
    metadata: metadata ? { ...(message.metadata ?? {}), ...metadata } : message.metadata,
  }))
}

function summarizeToolTarget(target?: ToolTargetDescriptor): string | undefined {
  if (!target) return undefined
  if (target.selector) return target.selector
  if (target.text) return target.text
  if (target.url) return target.url
  if (target.coordinates) return `${Math.round(target.coordinates.x)}, ${Math.round(target.coordinates.y)}`
  if (typeof target.tabId === 'number') return `Tab ${target.tabId}`
  if (typeof target.windowId === 'number') return `Window ${target.windowId}`
  return undefined
}

async function persistConversationState(
  conversations: StoredConversation[],
  conversationId: string,
  activeConversationId: string | null,
) {
  await setConversations(conversations)
  const conversation = conversations.find((item) => item.id === conversationId)
  if (conversation) {
    await emitConversationUpdate(conversation, activeConversationId)
  }
}

async function persistApprovalsState(approvals: ApprovalRequest[]) {
  await setApprovals(approvals)
  await emitApprovalsUpdate(approvals)
}

async function persistControlIndicatorState(controlIndicator: ControlIndicatorState | null) {
  await setControlIndicator(controlIndicator)
  await emitControlUpdate(controlIndicator)
}

function readOnlyTool(toolName: LocalToolName): boolean {
  return [
    'tabs.list',
    'windows.list',
    'page.inspect',
    'page.find',
    'page.wait_for',
    'page.screenshot',
  ].includes(toolName)
}

function requiresControlIndicator(toolName: LocalToolName): boolean {
  return toolName.startsWith('page.') || toolName.startsWith('tabs.') || toolName.startsWith('windows.')
}

function detailFromOutput(output: unknown): string {
  if (!output) return 'Completed.'
  if (typeof output === 'string') return output
  if (typeof output === 'object') {
    const record = output as Record<string, unknown>
    if (typeof record.summary === 'string' && record.summary.trim()) return record.summary
    if (typeof record.detail === 'string' && record.detail.trim()) return record.detail
  }
  return stringifyUnknown(output) || 'Completed.'
}

function normalizePlannerMetadata(statusLabel: string, toolName?: LocalToolName): Record<string, unknown> {
  return {
    statusLabel: statusLabel || (toolName ? `Working with ${toolName}` : 'Working'),
  }
}

function buildApprovalFromToolRequest(args: {
  run: ActiveRunState
  conversationId: string
  assistantMessageId: string
  toolCallId: string
  toolRequest: ActPlannerToolRequest
}): ApprovalRequest {
  return {
    id: createId('approval'),
    runId: args.run.id,
    conversationId: args.conversationId,
    assistantMessageId: args.assistantMessageId,
    toolCallId: args.toolCallId,
    toolName: args.toolRequest.toolName,
    summary: args.toolRequest.summary,
    args: args.toolRequest.args,
    createdAt: Date.now(),
    status: 'pending',
    readOnly: args.toolRequest.readOnly,
    target: args.toolRequest.target,
  }
}

function buildToolHistoryEntry(args: {
  runId: string
  conversationId: string
  toolCallId: string
  toolRequest: ActPlannerToolRequest
}): ToolHistoryEntry {
  return {
    id: createId('tool'),
    runId: args.runId,
    conversationId: args.conversationId,
    toolCallId: args.toolCallId,
    toolName: args.toolRequest.toolName,
    summary: args.toolRequest.summary,
    status: 'planned',
    createdAt: Date.now(),
  }
}

function getRunController(runId: string) {
  const existing = actRunControllers.get(runId)
  if (existing) return existing
  const next = { cancelled: false }
  actRunControllers.set(runId, next)
  return next
}

function removeRunController(runId: string) {
  actRunControllers.delete(runId)
}

async function sendTabMessageSafe<T = unknown>(tabId: number, message: unknown): Promise<T> {
  try {
    return await chrome.tabs.sendMessage(tabId, message) as T
  } catch {
    throw new Error('This page cannot be controlled by the extension.')
  }
}

async function waitForTabCompletion(tabId: number, timeoutMs = 12_000) {
  const existing = await chrome.tabs.get(tabId).catch(() => null)
  if (!existing) return
  if (existing.status === 'complete') return

  await new Promise<void>((resolve) => {
    const timeout = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener)
      resolve()
    }, timeoutMs)

    const listener = (updatedTabId: number, changeInfo: chrome.tabs.TabChangeInfo) => {
      if (updatedTabId !== tabId || changeInfo.status !== 'complete') return
      clearTimeout(timeout)
      chrome.tabs.onUpdated.removeListener(listener)
      resolve()
    }

    chrome.tabs.onUpdated.addListener(listener)
  })
}

async function resolveTargetTabId(args: Record<string, unknown>): Promise<number> {
  if (typeof args.tabId === 'number') return args.tabId
  const activeTabId = await getActiveTabId()
  if (!activeTabId) {
    throw new Error('No active tab is available.')
  }
  return activeTabId
}

async function activateControlIndicator(run: ActiveRunState, toolName: LocalToolName, args: Record<string, unknown>, target?: ToolTargetDescriptor) {
  const tabId = typeof target?.tabId === 'number'
    ? target.tabId
    : typeof args.tabId === 'number'
      ? args.tabId
      : await getActiveTabId()
  const tab = typeof tabId === 'number' ? await chrome.tabs.get(tabId).catch(() => null) : null
  const next: ControlIndicatorState = {
    runId: run.id,
    active: true,
    label: 'Overlay is controlling this page',
    updatedAt: Date.now(),
    mode: 'act',
    toolName,
    tabId: typeof tabId === 'number' ? tabId : undefined,
    windowId: tab?.windowId,
    targetLabel: summarizeToolTarget(target),
  }
  await persistControlIndicatorState(next)

  if (typeof tabId === 'number') {
    await sendTabMessageSafe(tabId, {
      type: 'overlay.control.activate',
      label: next.label,
      toolName,
      targetLabel: next.targetLabel,
    }).catch(() => {})
  }
}

async function deactivateControlIndicator() {
  const { controlIndicator } = await loadNormalizedStorage()
  if (controlIndicator?.tabId) {
    await sendTabMessageSafe(controlIndicator.tabId, {
      type: 'overlay.control.deactivate',
    }).catch(() => {})
  }
  await persistControlIndicatorState(null)
}

async function pulseControlAction(tabId: number, toolName: LocalToolName, args: Record<string, unknown>) {
  const typeMap: Partial<Record<LocalToolName, string>> = {
    'page.click': 'click',
    'page.click_at': 'click',
    'page.type': 'type',
    'page.press': 'type',
    'page.scroll': 'scroll',
    'page.hover': 'hover',
    'page.move_mouse': 'pointer',
    'page.drag': 'drag',
  }
  const pulseType = typeMap[toolName]
  if (!pulseType) return
  await sendTabMessageSafe(tabId, {
    type: 'overlay.control.pulse',
    pulseType,
    selector: typeof args.selector === 'string' ? args.selector : undefined,
    text: typeof args.text === 'string' ? args.text : undefined,
    coordinates:
      typeof args.x === 'number' && typeof args.y === 'number'
        ? { x: args.x, y: args.y }
        : typeof args.startX === 'number' && typeof args.startY === 'number'
          ? { x: args.startX, y: args.startY }
          : undefined,
  }).catch(() => {})
}

async function executeToolRequest(args: {
  run: ActiveRunState
  toolRequest: ActPlannerToolRequest
}): Promise<{ success: true; detail: string; output: unknown } | { success: false; error: string }> {
  const { run, toolRequest } = args

  const maybeControlledExecution = async (
    targetArgs: Record<string, unknown>,
    execute: () => Promise<{ detail: string; output: unknown }>,
  ) => {
    if (!requiresControlIndicator(toolRequest.toolName) || toolRequest.toolName === 'browser_run_task') {
      const result = await execute()
      return { success: true as const, ...result }
    }

    await activateControlIndicator(run, toolRequest.toolName, targetArgs, toolRequest.target)
    try {
      const tabId = typeof toolRequest.target?.tabId === 'number'
        ? toolRequest.target.tabId
        : typeof targetArgs.tabId === 'number'
          ? targetArgs.tabId
          : undefined
      if (typeof tabId === 'number') {
        await pulseControlAction(tabId, toolRequest.toolName, targetArgs)
      }
      const result = await execute()
      return { success: true as const, ...result }
    } finally {
      await deactivateControlIndicator()
    }
  }

  try {
    if (toolRequest.toolName === 'tabs.list') {
      const tabs = await captureCurrentWindowTabs()
      return {
        success: true,
        detail: tabs.length ? `Found ${tabs.length} tabs in the current window.` : 'No tabs available.',
        output: { summary: tabs.length ? `Found ${tabs.length} tabs in the current window.` : 'No tabs available.', tabs },
      }
    }

    if (toolRequest.toolName === 'windows.list') {
      const windows = await captureAllWindows()
      return {
        success: true,
        detail: windows.length ? `Found ${windows.length} browser windows.` : 'No browser windows available.',
        output: { summary: windows.length ? `Found ${windows.length} browser windows.` : 'No browser windows available.', windows },
      }
    }

    if (toolRequest.toolName === 'tabs.open') {
      return maybeControlledExecution(toolRequest.args, async () => {
        const tab = await chrome.tabs.create({
          url: typeof toolRequest.args.url === 'string' ? toolRequest.args.url : undefined,
          active: true,
        })
        if (typeof tab.id !== 'number') {
          throw new Error('Chrome did not return the new tab id.')
        }
        await waitForTabCompletion(tab.id)
        await sendTabMessageSafe(tab.id, {
          type: 'overlay.control.activate',
          label: 'Overlay is controlling this page',
          toolName: toolRequest.toolName,
          targetLabel: summarizeToolTarget(toolRequest.target),
        }).catch(() => {})
        return {
          detail: `Opened ${tab.url || 'a new tab'}.`,
          output: {
            summary: `Opened ${tab.url || 'a new tab'}.`,
            tabId: tab.id,
            windowId: tab.windowId,
            url: tab.url,
            title: tab.title,
          },
        }
      })
    }

    if (toolRequest.toolName === 'tabs.focus') {
      return maybeControlledExecution(toolRequest.args, async () => {
        const tabId = await resolveTargetTabId(toolRequest.args)
        const tab = await chrome.tabs.get(tabId)
        await chrome.tabs.update(tabId, { active: true })
        if (typeof tab.windowId === 'number') {
          await chrome.windows.update(tab.windowId, { focused: true })
        }
        await sendTabMessageSafe(tabId, {
          type: 'overlay.control.activate',
          label: 'Overlay is controlling this page',
          toolName: toolRequest.toolName,
          targetLabel: summarizeToolTarget(toolRequest.target),
        }).catch(() => {})
        return {
          detail: `Focused tab ${tabId}.`,
          output: { summary: `Focused tab ${tabId}.`, tabId, windowId: tab.windowId, url: tab.url, title: tab.title },
        }
      })
    }

    if (toolRequest.toolName === 'tabs.close') {
      return maybeControlledExecution(toolRequest.args, async () => {
        const tabId = await resolveTargetTabId(toolRequest.args)
        await chrome.tabs.remove(tabId)
        return {
          detail: `Closed tab ${tabId}.`,
          output: { summary: `Closed tab ${tabId}.`, tabId },
        }
      })
    }

    if (toolRequest.toolName === 'tabs.navigate') {
      return maybeControlledExecution(toolRequest.args, async () => {
        const tabId = await resolveTargetTabId(toolRequest.args)
        const url = typeof toolRequest.args.url === 'string' ? toolRequest.args.url : ''
        if (!url) throw new Error('Missing URL for navigation.')
        const updated = (await chrome.tabs.update(tabId, { url, active: true })) ?? await chrome.tabs.get(tabId)
        if (typeof updated.windowId === 'number') {
          await chrome.windows.update(updated.windowId, { focused: true })
        }
        await waitForTabCompletion(tabId)
        await sendTabMessageSafe(tabId, {
          type: 'overlay.control.activate',
          label: 'Overlay is controlling this page',
          toolName: toolRequest.toolName,
          targetLabel: summarizeToolTarget(toolRequest.target) || url,
        }).catch(() => {})
        return {
          detail: `Navigated tab ${tabId} to ${url}.`,
          output: { summary: `Navigated tab ${tabId} to ${url}.`, tabId, windowId: updated.windowId, url },
        }
      })
    }

    if (toolRequest.toolName === 'tabs.reload') {
      return maybeControlledExecution(toolRequest.args, async () => {
        const tabId = await resolveTargetTabId(toolRequest.args)
        await chrome.tabs.reload(tabId)
        await waitForTabCompletion(tabId)
        await sendTabMessageSafe(tabId, {
          type: 'overlay.control.activate',
          label: 'Overlay is controlling this page',
          toolName: toolRequest.toolName,
          targetLabel: summarizeToolTarget(toolRequest.target),
        }).catch(() => {})
        return {
          detail: `Reloaded tab ${tabId}.`,
          output: { summary: `Reloaded tab ${tabId}.`, tabId },
        }
      })
    }

    if (toolRequest.toolName === 'windows.focus') {
      return maybeControlledExecution(toolRequest.args, async () => {
        const windowId = typeof toolRequest.args.windowId === 'number' ? toolRequest.args.windowId : NaN
        if (!Number.isFinite(windowId)) throw new Error('Missing windowId to focus.')
        const updated = await chrome.windows.update(windowId, { focused: true })
        return {
          detail: `Focused window ${windowId}.`,
          output: { summary: `Focused window ${windowId}.`, windowId: updated.id },
        }
      })
    }

    if (toolRequest.toolName === 'browser_run_task') {
      const task = typeof toolRequest.args.task === 'string' ? toolRequest.args.task.trim() : ''
      if (!task) throw new Error('Missing task for browser_run_task.')
      const storage = await loadNormalizedStorage()
      const preferences: ExtensionPreferences = {
        ...mergeStoredPreferences(storage.preferences),
        baseUrl: await resolveDefaultBaseUrl(storage.preferences),
      }
      const output = await runRemoteBrowserTask({
        preferences,
        session: storage.session,
        task,
      })
      return {
        success: true,
        detail: typeof output.output === 'string' ? output.output : 'Completed remote browser task.',
        output: {
          summary: typeof output.output === 'string' ? output.output : 'Completed remote browser task.',
          liveUrl: output.liveUrl ?? null,
          sessionId: output.sessionId,
          status: output.status,
          billing: output.billing,
        },
      }
    }

    const tabId = await resolveTargetTabId(toolRequest.args)
    if (toolRequest.toolName === 'page.screenshot') {
      return maybeControlledExecution({ ...toolRequest.args, tabId }, async () => {
        const tab = await chrome.tabs.get(tabId)
        if (!tab.active) {
          await chrome.tabs.update(tabId, { active: true })
          if (typeof tab.windowId === 'number') {
            await chrome.windows.update(tab.windowId, { focused: true })
          }
        }
        const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' })
        return {
          detail: 'Captured a screenshot of the current page.',
          output: { summary: 'Captured a screenshot of the current page.', dataUrl },
        }
      })
    }

    const messageTypeByTool: Partial<Record<LocalToolName, string>> = {
      'page.inspect': 'overlay.tool.inspect-page',
      'page.find': 'overlay.tool.find',
      'page.click': 'overlay.tool.click',
      'page.type': 'overlay.tool.type',
      'page.press': 'overlay.tool.press',
      'page.select': 'overlay.tool.select',
      'page.scroll': 'overlay.tool.scroll',
      'page.hover': 'overlay.tool.hover',
      'page.wait_for': 'overlay.tool.wait-for',
      'page.click_at': 'overlay.tool.click-at',
      'page.move_mouse': 'overlay.tool.move-mouse',
      'page.drag': 'overlay.tool.drag',
    }

    const messageType = messageTypeByTool[toolRequest.toolName]
    if (!messageType) {
      throw new Error(`Unsupported tool: ${toolRequest.toolName}`)
    }

    return maybeControlledExecution({ ...toolRequest.args, tabId }, async () => {
      const response = await sendTabMessageSafe<{
        success?: boolean
        result?: unknown
        error?: string
      }>(tabId, {
        type: messageType,
        ...toolRequest.args,
      })
      if (!response?.success) {
        throw new Error(response?.error || 'Tool execution failed.')
      }

      return {
        detail: detailFromOutput(response.result),
        output: response.result,
      }
    })
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Tool execution failed.',
    }
  }
}

async function finalizeActRun(runId: string, status: ActiveRunState['status'], error?: string) {
  const storage = await loadNormalizedStorage()
  const found = findRunByRunId(storage.activeRuns, runId)
  if (!found || found.run.mode !== 'act' || found.run.id !== runId) return
  const { conversationId, run } = found

  const remainingApprovals = storage.approvals.filter((approval) => approval.runId !== runId)
  await persistApprovalsState(remainingApprovals)
  await deactivateControlIndicator()
  await setRunForConversation(conversationId, null)
  await emitRunUpdate(conversationId, null)
  removeRunController(runId)

  if (status === 'cancelled' || status === 'failed') {
    const conversations = updateConversation(storage.conversations, conversationId, (conversation) => {
      const assistantMessageId = run.assistantMessageId
      if (!assistantMessageId) return conversation
      const updated = appendAssistantText(
        conversation,
        assistantMessageId,
        status === 'cancelled' ? 'Stopped the act run.' : (error || 'Act run failed.'),
        { statusLabel: status === 'cancelled' ? 'Run cancelled' : 'Run failed' },
      )
      return {
        ...updated,
        updatedAt: Date.now(),
        preview: makeConversationPreview(updated),
      }
    })
    await persistConversationState(conversations, conversationId, conversationId)
  }
}

export async function startChatRun(params: {
  conversationId: string
  prompt: string
  scope: BrowserScopeMode
  sourceTabId: number
  attachments?: AttachmentDraft[]
}): Promise<ActiveRunState[]> {
  const storage = await loadNormalizedStorage()
  const hasLive = Object.keys(storage.activeRuns).some(
    (key) => key === params.conversationId || key.startsWith(`${params.conversationId}#`),
  )
  if (hasLive) {
    throw new Error('A chat run is already in progress for this conversation.')
  }
  if (!storage.session?.accessToken?.trim() || !storage.session.user?.id?.trim()) {
    throw new Error('Sign in on Overlay to chat.')
  }

  const resolvedPreferences: ExtensionPreferences = {
    ...mergeStoredPreferences(storage.preferences),
    baseUrl: await resolveDefaultBaseUrl(storage.preferences),
  }
  const modelIds = resolveAskModelIds(resolvedPreferences)
  const [pageContext, windowTabs] = await Promise.all([
    capturePageContextForTab(params.sourceTabId),
    captureCurrentWindowTabs(),
  ])
  const promptForModel = buildBrowserContextPrompt({
    question: params.prompt,
    scope: params.scope,
    pageContext,
    windowTabs,
  })
  const attachmentFileParts: MessageFilePart[] = (params.attachments ?? [])
    .filter((attachment) => attachment.kind === 'image' && attachment.dataUrl)
    .map((attachment) => createFilePart(attachment.dataUrl!, attachment.mimeType))
  const indexedDocuments = (params.attachments ?? [])
    .filter((attachment) => attachment.kind === 'document' && attachment.status === 'ready')
    .map((attachment) => attachment.name)

  let conversation = storage.conversations.find((item) => item.id === params.conversationId)
  if (!conversation) {
    conversation = await createRemoteConversation({
      baseUrl: resolvedPreferences.baseUrl,
      session: storage.session,
      title: 'New Chat',
      askModelIds: modelIds,
      actModelId: modelIds[0],
    })
  }

  const createdAt = Date.now()
  const turnId = createId('turn')
  const userParts: ConversationMessagePart[] = [createTextPart(params.prompt), ...attachmentFileParts]
  if (indexedDocuments.length > 0) {
    userParts.push(createTextPart(`[Indexed documents: ${indexedDocuments.join(', ')}]`))
  }
  const userMessage: ConversationMessage = {
    id: turnId,
    role: 'user',
    parts: userParts,
    createdAt,
    turnId,
    metadata: indexedDocuments.length > 0 ? { indexedDocuments } : undefined,
  }
  const assistantMessages = modelIds.map((modelId, variantIndex): ConversationMessage => ({
    id: createId('message'),
    role: 'assistant',
    parts: [],
    createdAt: createdAt + 1 + variantIndex,
    turnId,
    variantIndex,
    modelId,
    metadata: {
      statusLabel: 'Thinking',
      modelId,
    },
  }))

  const nextConversationBase: StoredConversation = {
    ...conversation,
    title: conversation.messages.length === 0 ? truncate(params.prompt, 42) || conversation.title : conversation.title,
    messages: [...conversation.messages, userMessage, ...assistantMessages],
    updatedAt: Date.now(),
    preview: '',
    version: 3,
    browserScope: params.scope,
  }
  const nextConversation: StoredConversation = {
    ...nextConversationBase,
    preview: makeConversationPreview(nextConversationBase),
  }
  const nextConversations = withUpdatedConversation(storage.conversations, nextConversation)
  await setConversations(nextConversations)
  await setActiveConversationId(nextConversation.id)
  await emitConversationUpdate(nextConversation, nextConversation.id)

  const runs = assistantMessages.map((assistant, variantIndex): ActiveRunState => ({
    id: createId('run'),
    conversationId: nextConversation.id,
    mode: 'act',
    status: 'streaming',
    startedAt: Date.now(),
    updatedAt: Date.now(),
    assistantMessageId: assistant.id,
    sourceTabId: params.sourceTabId,
    turnId,
    variantIndex,
    modelId: modelIds[variantIndex],
  }))
  for (const run of runs) {
    await setRunForConversation(nextConversation.id, run, run.variantIndex)
    await emitRunUpdate(nextConversation.id, run)
  }

  runs.forEach((run) => {
    const controller = new AbortController()
    chatRunControllers.set(run.id, controller)
    void streamRemoteChatTurn({
      baseUrl: resolvedPreferences.baseUrl,
      session: storage.session!,
      conversationId: nextConversation.id,
      turnId,
      prompt: params.prompt,
      systemPrompt: promptForModel,
      modelId: run.modelId || modelIds[0]!,
      variantIndex: run.variantIndex ?? 0,
      variantTotal: modelIds.length,
      attachments: params.attachments,
      signal: controller.signal,
      onChunk: async (chunk) => {
        const fresh = await loadNormalizedStorage()
        const updated = updateConversation(fresh.conversations, nextConversation.id, (currentConversation) => {
          const withChunk = updateConversationMessage(currentConversation, run.assistantMessageId!, (message) =>
            applyAskChunkToMessage(message, chunk),
          )
          return {
            ...withChunk,
            updatedAt: Date.now(),
            preview: makeConversationPreview(withChunk),
          }
        })
        await persistConversationState(updated, nextConversation.id, nextConversation.id)
      },
    })
      .then(async () => {
        chatRunControllers.delete(run.id)
        await setRunForConversation(nextConversation.id, null, run.variantIndex)
        await emitRunUpdate(nextConversation.id, null, run.variantIndex)
        const remote = await fetchRemoteConversationWithMessages({
          baseUrl: resolvedPreferences.baseUrl,
          session: storage.session!,
          conversationId: nextConversation.id,
        }).catch(() => null)
        if (remote) {
          const fresh = await loadNormalizedStorage()
          await persistConversationState(withUpdatedConversation(fresh.conversations, remote), remote.id, remote.id)
        }
        if (conversation!.messages.length === 0) {
          void renameConversationTitleFromRemote({
            conversationId: nextConversation.id,
            baseUrl: resolvedPreferences.baseUrl,
            session: storage.session!,
            sourceText: params.prompt,
          }).catch(() => {})
        }
      })
      .catch(async (error) => {
        chatRunControllers.delete(run.id)
        const message = error instanceof Error && error.name === 'AbortError'
          ? 'Chat stopped.'
          : error instanceof Error
            ? error.message
            : 'Chat failed.'
        const fresh = await loadNormalizedStorage()
        const updated = updateConversation(fresh.conversations, nextConversation.id, (currentConversation) => {
          const withError = updateConversationMessage(currentConversation, run.assistantMessageId!, (assistant) => ({
            ...assistant,
            parts: assistant.parts.length > 0 ? assistant.parts : [createTextPart(message)],
            metadata: { ...(assistant.metadata ?? {}), streamError: message },
          }))
          return {
            ...withError,
            updatedAt: Date.now(),
            preview: makeConversationPreview(withError),
          }
        })
        await persistConversationState(updated, nextConversation.id, nextConversation.id)
        await setRunForConversation(nextConversation.id, null, run.variantIndex)
        await emitRunUpdate(nextConversation.id, null, run.variantIndex)
        if (message !== 'Chat stopped.') {
          emitRuntimeStreamEvent({ type: 'overlay.runtime.stream.error', error: message })
        }
      })
  })

  return runs
}

export async function stopChatRun(conversationId: string) {
  const storage = await loadNormalizedStorage()
  for (const [key, run] of Object.entries(storage.activeRuns)) {
    if (key !== conversationId && !key.startsWith(`${conversationId}#`)) continue
    const controller = chatRunControllers.get(run.id)
    controller?.abort()
    chatRunControllers.delete(run.id)
    await setRunForConversation(conversationId, null, run.variantIndex)
    await emitRunUpdate(conversationId, null, run.variantIndex)
  }
}

async function continueActRun(runId: string): Promise<void> {
  const controller = getRunController(runId)
  if (controller.cancelled) return

  const storage = await loadNormalizedStorage()
  const found = findRunByRunId(storage.activeRuns, runId)
  if (!found) return
  const { conversationId, run } = found
  if (run.id !== runId || run.mode !== 'act') return
  if (run.status === 'awaiting_approval' || run.status === 'cancelled') return
  if ((run.stepCount ?? 0) >= 12) {
    await finalizeActRun(runId, 'completed')
    return
  }

  const conversation = storage.conversations.find((item) => item.id === run.conversationId)
  if (!conversation || !run.assistantMessageId) {
    await finalizeActRun(runId, 'failed', 'Act conversation state is missing.')
    return
  }

  const nextRun: ActiveRunState = {
    ...run,
    status: 'streaming',
    updatedAt: Date.now(),
  }
  await setRunForConversation(conversationId, nextRun)
  await emitRunUpdate(conversationId, nextRun)

  try {
    const preferences: ExtensionPreferences = {
      ...mergeStoredPreferences(storage.preferences),
      baseUrl: await resolveDefaultBaseUrl(storage.preferences),
    }
    const [pageContext, windowTabs, windows] = await Promise.all([
      typeof run.sourceTabId === 'number'
        ? capturePageContextForTab(run.sourceTabId)
        : captureActivePageContext(),
      captureCurrentWindowTabs(),
      captureAllWindows(),
    ])
    const plan = await runRemoteActPlanner({
      preferences,
      session: storage.session,
      conversation,
      pageContext,
      windowTabs,
      windows,
    })

    if (controller.cancelled) {
      await finalizeActRun(runId, 'cancelled')
      return
    }

    let nextConversations = updateConversation(storage.conversations, run.conversationId, (currentConversation) => {
      let updatedConversation = currentConversation
      if (plan.assistantText.trim()) {
        updatedConversation = appendAssistantText(
          updatedConversation,
          run.assistantMessageId!,
          plan.assistantText,
          normalizePlannerMetadata(plan.statusLabel, plan.toolRequest?.toolName),
        )
      } else if (plan.statusLabel.trim()) {
        updatedConversation = updateConversationMessage(updatedConversation, run.assistantMessageId!, (message) => ({
          ...message,
          metadata: { ...(message.metadata ?? {}), statusLabel: plan.statusLabel },
        }))
      }
      updatedConversation = {
        ...updatedConversation,
        updatedAt: Date.now(),
        preview: makeConversationPreview(updatedConversation),
      }
      return updatedConversation
    })
    await persistConversationState(nextConversations, run.conversationId, run.conversationId)

    if (plan.complete || !plan.toolRequest) {
      await finalizeActRun(runId, 'completed')
      return
    }

    const toolCallId = createId('tool-call')
    const toolPart: MessageToolPart = {
      type: 'tool',
      id: toolCallId,
      toolCallId,
      toolName: plan.toolRequest.toolName,
      state: 'input-available',
      input: plan.toolRequest.args,
      providerExecuted: false,
      dynamic: false,
      title: plan.toolRequest.summary,
    }

    nextConversations = updateConversation(nextConversations, run.conversationId, (currentConversation) => {
      const updatedConversation = upsertAssistantTool(
        currentConversation,
        run.assistantMessageId!,
        toolPart,
        normalizePlannerMetadata(plan.statusLabel, plan.toolRequest?.toolName),
      )
      return {
        ...updatedConversation,
        updatedAt: Date.now(),
        preview: makeConversationPreview(updatedConversation),
      }
    })
    await persistConversationState(nextConversations, run.conversationId, run.conversationId)

    const historyEntry = buildToolHistoryEntry({
      runId,
      conversationId: run.conversationId,
      toolCallId,
      toolRequest: plan.toolRequest,
    })
    const nextToolHistory = [historyEntry, ...storage.toolHistory].slice(0, 40)
    await setToolHistory(nextToolHistory)

    const destructiveTool = !readOnlyTool(plan.toolRequest.toolName) && !plan.toolRequest.readOnly
    // Per-conversation allowlist + approval mode, checked against the latest
    // conversation state (which may have been updated by `approve-allowlist`
    // since this run started).
    const liveConvForApproval = nextConversations.find((c) => c.id === run.conversationId)
    const convAllowlist = Array.isArray(liveConvForApproval?.actAllowlist)
      ? (liveConvForApproval!.actAllowlist as string[])
      : []
    const isAllowlisted = convAllowlist.includes(plan.toolRequest.toolName)
    const autoMode = run.actPolicy === 'autonomous' || liveConvForApproval?.actApprovalMode === 'auto'
    if (destructiveTool && !autoMode && !isAllowlisted) {
      const approval = buildApprovalFromToolRequest({
        run,
        conversationId: run.conversationId,
        assistantMessageId: run.assistantMessageId,
        toolCallId,
        toolRequest: plan.toolRequest,
      })
      await persistApprovalsState([approval, ...storage.approvals])
      const awaitingRun: ActiveRunState = {
        ...nextRun,
        status: 'awaiting_approval',
        updatedAt: Date.now(),
        latestToolName: plan.toolRequest.toolName,
        stepCount: (run.stepCount ?? 0) + 1,
      }
      await setRunForConversation(conversationId, awaitingRun)
      await emitRunUpdate(conversationId, awaitingRun)
      return
    }

    const executingRun: ActiveRunState = {
      ...nextRun,
      status: 'executing_tool',
      updatedAt: Date.now(),
      latestToolName: plan.toolRequest.toolName,
      stepCount: (run.stepCount ?? 0) + 1,
    }
    await setRunForConversation(conversationId, executingRun)
    await emitRunUpdate(conversationId, executingRun)

    const execution = await executeToolRequest({ run: executingRun, toolRequest: plan.toolRequest })
    const refreshedStorage = await loadNormalizedStorage()
    const refreshedConversations = updateConversation(refreshedStorage.conversations, run.conversationId, (currentConversation) => {
      const updatedConversation = upsertAssistantTool(currentConversation, run.assistantMessageId!, {
        ...toolPart,
        state: execution.success ? 'output-available' : 'output-error',
        output: execution.success ? execution.output : undefined,
        errorText: execution.success ? undefined : execution.error,
      }, normalizePlannerMetadata(execution.success ? 'Tool completed' : 'Tool failed', plan.toolRequest?.toolName))
      return {
        ...updatedConversation,
        updatedAt: Date.now(),
        preview: makeConversationPreview(updatedConversation),
      }
    })
    await persistConversationState(refreshedConversations, run.conversationId, run.conversationId)

    const updatedHistory = refreshedStorage.toolHistory.map((entry) => (
      entry.id === historyEntry.id
        ? ({
            ...entry,
            status: execution.success ? 'completed' : 'failed',
            detail: execution.success ? execution.detail : execution.error,
          } satisfies ToolHistoryEntry)
        : entry
    ))
    await setToolHistory(updatedHistory)

    const resumedRun: ActiveRunState = {
      ...executingRun,
      status: 'streaming',
      updatedAt: Date.now(),
    }
    await setRunForConversation(conversationId, resumedRun)
    await emitRunUpdate(conversationId, resumedRun)

    if (!controller.cancelled) {
      await continueActRun(runId)
    }
  } catch (error) {
    await finalizeActRun(runId, 'failed', error instanceof Error ? error.message : 'Act run failed.')
    emitRuntimeStreamEvent({
      type: 'overlay.runtime.stream.error',
      error: error instanceof Error ? error.message : 'Act run failed.',
    })
  }
}

export async function startActRun(params: {
  conversationId: string
  prompt: string
  scope: BrowserScopeMode
  sourceTabId: number
  actPolicy?: 'approval' | 'autonomous'
  attachments?: AttachmentDraft[]
}): Promise<ActiveRunState> {
  const storage = await loadNormalizedStorage()
  const hasLive = Object.keys(storage.activeRuns).some(
    (key) => key === params.conversationId || key.startsWith(`${params.conversationId}#`),
  )
  if (hasLive) {
    throw new Error('A chat run is already in progress for this conversation.')
  }

  const resolvedPreferences: ExtensionPreferences = {
    ...mergeStoredPreferences(storage.preferences),
    baseUrl: await resolveDefaultBaseUrl(storage.preferences),
  }

  const pageContext = await capturePageContextForTab(params.sourceTabId)
  const windowTabs = await captureCurrentWindowTabs()
  const composed = buildBrowserContextPrompt({
    question: params.prompt,
    scope: params.scope,
    pageContext,
    windowTabs,
  })

  const attachmentFileParts: MessageFilePart[] = (params.attachments ?? [])
    .filter((attachment) => attachment.kind === 'image' && attachment.dataUrl)
    .map((attachment) => createFilePart(attachment.dataUrl!, attachment.mimeType))
  const indexedDocuments = (params.attachments ?? [])
    .filter((attachment) => attachment.kind === 'document' && attachment.status === 'ready')
    .map((attachment) => attachment.name)

  const userParts: ConversationMessagePart[] = [createTextPart(composed), ...attachmentFileParts]
  if (indexedDocuments.length > 0) {
    userParts.push(createTextPart(`[Indexed documents: ${indexedDocuments.join(', ')}]`))
  }

  let conversation = storage.conversations.find((item) => item.id === params.conversationId)
  if (!conversation) {
    conversation = {
      id: params.conversationId,
      title: 'New Chat',
      preview: '',
      updatedAt: Date.now(),
      messages: [],
      version: 3,
    }
  }

  const createdAt = Date.now()
  const userMessage: ConversationMessage = {
    id: createId('message'),
    role: 'user',
    parts: userParts,
    createdAt,
    ...(indexedDocuments.length > 0 ? { metadata: { indexedDocuments } } : {}),
  }
  const assistantMessageId = createId('message')
  const assistantMessage: ConversationMessage = {
    id: assistantMessageId,
    role: 'assistant',
    parts: [],
    createdAt: createdAt + 1,
    metadata: {
      statusLabel: 'Planning browser actions',
    },
  }

  const nextConversationBase: StoredConversation = {
    ...conversation,
    title: conversation.messages.length === 0 ? truncate(params.prompt, 42) || conversation.title : conversation.title,
    messages: [...conversation.messages, userMessage, assistantMessage],
    updatedAt: assistantMessage.createdAt,
    preview: '',
    version: 3,
  }
  const nextConversation: StoredConversation = {
    ...nextConversationBase,
    preview: makeConversationPreview(nextConversationBase),
  }

  const nextConversations = withUpdatedConversation(storage.conversations, nextConversation)
  await setConversations(nextConversations)
  await setActiveConversationId(nextConversation.id)
  await emitConversationUpdate(nextConversation, nextConversation.id)

  const run: ActiveRunState = {
    id: createId('run'),
    conversationId: nextConversation.id,
    mode: 'act',
    status: 'streaming',
    startedAt: Date.now(),
    updatedAt: Date.now(),
    assistantMessageId,
    stepCount: 0,
    sourceTabId: params.sourceTabId,
    actPolicy: params.actPolicy ?? 'approval',
  }
  await setRunForConversation(nextConversation.id, run)
  await emitRunUpdate(nextConversation.id, run)
  getRunController(run.id)

  void ensureConversationTabGroupMetadata({
    conversationId: nextConversation.id,
    sourceTabId: params.sourceTabId,
  }).then((groupId) => {
    if (groupId == null) return
    scheduleTabGroupLabelUpdate({
      groupId,
      labelSourceText: params.prompt.trim() || pageContext?.title || 'Chat',
      baseUrl: resolvedPreferences.baseUrl,
      session: storage.session,
    })
  })

  if (conversation.messages.length === 0 && storage.session?.accessToken && storage.session.user?.id) {
    void renameConversationTitleFromRemote({
      conversationId: nextConversation.id,
      baseUrl: resolvedPreferences.baseUrl,
      session: storage.session,
      sourceText: params.prompt,
    }).catch(() => {})
  }

  void continueActRun(run.id)
  return run
}

export async function stopActRun(conversationId: string) {
  const storage = await loadNormalizedStorage()
  const activeRun = storage.activeRuns[conversationId]
  if (!activeRun || activeRun.mode !== 'act') return

  const controller = getRunController(activeRun.id)
  controller.cancelled = true
  await finalizeActRun(activeRun.id, 'cancelled')
}

export async function resolveApproval(params: {
  approvalId: string
  decision: 'approve' | 'reject' | 'approve-allowlist'
}): Promise<RuntimeBootstrap> {
  const storage = await loadNormalizedStorage()
  const approval = storage.approvals.find((item) => item.id === params.approvalId)
  if (!approval) {
    throw new Error('Approval not found.')
  }

  const run = storage.activeRuns[approval.conversationId]
  if (!run || run.id !== approval.runId || run.mode !== 'act') {
    throw new Error('The associated act run is no longer active.')
  }

  const remainingApprovals = storage.approvals.filter((item) => item.id !== params.approvalId)
  await persistApprovalsState(remainingApprovals)

  const isApproved = params.decision === 'approve' || params.decision === 'approve-allowlist'

  let nextConversations = updateConversation(storage.conversations, approval.conversationId, (conversation) => {
    let updatedConversation = upsertAssistantTool(conversation, approval.assistantMessageId, {
      type: 'tool',
      id: approval.toolCallId,
      toolCallId: approval.toolCallId,
      toolName: approval.toolName,
      state: isApproved ? 'input-available' : 'output-denied',
      input: approval.args,
      errorText: params.decision === 'reject' ? 'User rejected this action.' : undefined,
      title: approval.summary,
    }, { statusLabel: isApproved ? 'Executing approved action' : 'Action rejected' })

    // approve-allowlist: add the tool name to the conversation's allowlist so
    // subsequent calls to the same tool in this conversation skip the approval
    // gate. Allowlist is wiped on conversation switch (see Phase 6).
    if (params.decision === 'approve-allowlist') {
      const existing = Array.isArray(updatedConversation.actAllowlist)
        ? (updatedConversation.actAllowlist as string[])
        : []
      if (!existing.includes(approval.toolName)) {
        updatedConversation = {
          ...updatedConversation,
          actAllowlist: [...existing, approval.toolName] as StoredConversation['actAllowlist'],
        }
      }
    }

    return {
      ...updatedConversation,
      updatedAt: Date.now(),
      preview: makeConversationPreview(updatedConversation),
    }
  })
  await persistConversationState(nextConversations, approval.conversationId, approval.conversationId)

  const nextToolHistory = storage.toolHistory.map((entry) => (
    entry.toolCallId === approval.toolCallId
      ? ({
          ...entry,
          status: params.decision === 'approve' ? 'approved' : 'rejected',
          detail: params.decision === 'approve' ? 'Approved for execution.' : 'Rejected by user.',
        } satisfies ToolHistoryEntry)
      : entry
  ))
  await setToolHistory(nextToolHistory)

  if (params.decision === 'reject') {
    const resumedRun: ActiveRunState = {
      ...run,
      status: 'streaming',
      updatedAt: Date.now(),
    }
    await setRunForConversation(approval.conversationId, resumedRun)
    await emitRunUpdate(approval.conversationId, resumedRun)
    void continueActRun(run.id)
    return bootstrapRuntime()
  }

  const executingRun: ActiveRunState = {
    ...run,
    status: 'executing_tool',
    updatedAt: Date.now(),
    latestToolName: approval.toolName,
  }
  await setRunForConversation(approval.conversationId, executingRun)
  await emitRunUpdate(approval.conversationId, executingRun)

  const execution = await executeToolRequest({
    run: executingRun,
    toolRequest: {
      toolName: approval.toolName,
      summary: approval.summary,
      readOnly: approval.readOnly,
      args: approval.args,
      target: approval.target,
    },
  })

  const refreshedStorage = await loadNormalizedStorage()
  nextConversations = updateConversation(refreshedStorage.conversations, approval.conversationId, (conversation) => {
    const updatedConversation = upsertAssistantTool(conversation, approval.assistantMessageId, {
      type: 'tool',
      id: approval.toolCallId,
      toolCallId: approval.toolCallId,
      toolName: approval.toolName,
      state: execution.success ? 'output-available' : 'output-error',
      input: approval.args,
      output: execution.success ? execution.output : undefined,
      errorText: execution.success ? undefined : execution.error,
      title: approval.summary,
    }, { statusLabel: execution.success ? 'Action completed' : 'Action failed' })
    return {
      ...updatedConversation,
      updatedAt: Date.now(),
      preview: makeConversationPreview(updatedConversation),
    }
  })
  await persistConversationState(nextConversations, approval.conversationId, approval.conversationId)

  const updatedHistory = refreshedStorage.toolHistory.map((entry) => (
    entry.toolCallId === approval.toolCallId
      ? ({
          ...entry,
          status: execution.success ? 'completed' : 'failed',
          detail: execution.success ? execution.detail : execution.error,
        } satisfies ToolHistoryEntry)
      : entry
  ))
  await setToolHistory(updatedHistory)

  const resumedRun: ActiveRunState = {
    ...executingRun,
    status: 'streaming',
    updatedAt: Date.now(),
  }
  await setRunForConversation(approval.conversationId, resumedRun)
  await emitRunUpdate(approval.conversationId, resumedRun)
  void continueActRun(run.id)
  return bootstrapRuntime()
}

export async function captureBrowserContextEnvelope(): Promise<BrowserContextEnvelope> {
  const [pageContext, windowTabs] = await Promise.all([
    captureActivePageContext(),
    captureCurrentWindowTabs(),
  ])
  return { pageContext, windowTabs }
}

export async function refreshEntitlements(): Promise<EntitlementsSnapshot | null> {
  const storage = await loadNormalizedStorage()
  const baseUrl = await resolveDefaultBaseUrl(storage.preferences)
  if (!storage.session) {
    await setEntitlements(null)
    return null
  }
  const remote = await fetchRemoteEntitlements({
    baseUrl,
    session: storage.session,
  }).catch(() => null)
  if (!remote) {
    await setEntitlements(null)
    return null
  }
  const snapshot: EntitlementsSnapshot = {
    tier: remote.tier,
    planKind: remote.planKind,
    isPaid: remote.planKind === 'paid' || remote.tier === 'pro' || remote.tier === 'max',
    creditsUsed: remote.creditsUsed,
    creditsTotal: remote.creditsTotal,
    fetchedAt: Date.now(),
  }
  await setEntitlements(snapshot)
  return snapshot
}

export async function refreshParitySnapshot() {
  const storage = await loadNormalizedStorage()
  const baseUrl = await resolveDefaultBaseUrl(storage.preferences)
  if (!storage.session?.accessToken?.trim() || !storage.session.user?.id?.trim()) {
    return null
  }
  return fetchRemoteParitySnapshot({ baseUrl, session: storage.session }).catch(() => null)
}

export async function ingestDocument(args: {
  fileName: string
  mimeType: string
  base64: string
}): Promise<{ documentId: string; indexedFileName: string }> {
  const storage = await loadNormalizedStorage()
  const baseUrl = await resolveDefaultBaseUrl(storage.preferences)
  if (!storage.session?.accessToken?.trim() || !storage.session.user?.id?.trim()) {
    throw new Error('Sign in on Overlay to upload documents.')
  }
  return ingestRemoteDocument({
    baseUrl,
    session: storage.session,
    fileName: args.fileName,
    mimeType: args.mimeType,
    base64: args.base64,
  })
}

export async function transcribeAudio(args: {
  mimeType: string
  base64: string
}): Promise<{ text: string }> {
  const storage = await loadNormalizedStorage()
  const baseUrl = await resolveDefaultBaseUrl(storage.preferences)
  if (!storage.session?.accessToken?.trim() || !storage.session.user?.id?.trim()) {
    throw new Error('Sign in on Overlay to transcribe audio.')
  }
  return transcribeRemoteAudio({
    baseUrl,
    session: storage.session,
    mimeType: args.mimeType,
    base64: args.base64,
  })
}
