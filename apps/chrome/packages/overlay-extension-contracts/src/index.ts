export * from './models-catalog'
import type { GenerationMode } from './models-catalog'

/**
 * Browser scope for page / tab tools. `active-tab` targets only the tab behind
 * the side panel; `current-window` extends to every tab in that window;
 * `all-windows` fans out to every Chrome window the user has open (requires
 * an extra confirmation in the UI because it is significantly more invasive).
 *
 * `BrowserScope` is the legacy narrow union kept for backward compatibility.
 * New code should prefer `BrowserScopeMode`.
 */
export type BrowserScope = 'active-tab' | 'current-window'
export type BrowserScopeMode = BrowserScope | 'all-windows'

/** Approval posture for Act-mode destructive tools. */
export type ActApprovalMode = 'ask' | 'auto'

/**
 * Local tools that mutate external state (tabs, page DOM, navigation). These
 * always require an approval card when `actApprovalMode === 'ask'`. Read-only
 * tools (`tabs.list`, `windows.list`, `page.inspect`, `page.find`,
 * `page.screenshot`, `page.wait_for`) are excluded so the model can gather
 * context without prompting.
 */
export const WRITE_CLASS_TOOL_NAMES = [
  'tabs.open',
  'tabs.focus',
  'tabs.close',
  'tabs.navigate',
  'tabs.reload',
  'windows.focus',
  'page.scroll',
  'page.click',
  'page.type',
  'page.press',
  'page.select',
  'page.hover',
  'page.click_at',
  'page.move_mouse',
  'page.drag',
  'browser_run_task',
] as const

export type WriteClassToolName = (typeof WRITE_CLASS_TOOL_NAMES)[number]

export function isWriteClassTool(name: string): name is WriteClassToolName {
  return (WRITE_CLASS_TOOL_NAMES as readonly string[]).includes(name)
}

export interface TabLinkSummary {
  text: string
  href: string
}

export interface InteractiveElementSummary {
  tagName: string
  role: string | null
  text: string | null
}

export interface PageContextSnapshot {
  capturedAt: number
  tabId?: number
  url: string
  title: string
  selection: string | null
  excerpt: string
  headings: string[]
  links: TabLinkSummary[]
  scrollY?: number
  viewportWidth?: number
  viewportHeight?: number
  focusedElement?: InteractiveElementSummary | null
  interactiveElements?: InteractiveElementSummary[]
}

export interface WindowSnapshot {
  windowId: number
  focused: boolean
  tabCount: number
}

export interface WindowTabSnapshot {
  tabId: number
  title: string
  url: string
  active: boolean
  status: string
}

export interface ExtensionCapabilities {
  installed: true
  version: string
  phase: 'phase-2-4'
  sidePanelEnabled: boolean
  scopes: BrowserScope[]
  bridgeOrigins: string[]
}

export interface PanelRuntimeState {
  phase: 'phase-2-4'
  sidePanelPath: string
  surfaceStatus: {
    background: 'ready'
    contentScript: 'ready'
    webBridge: 'ready'
  }
}

export interface ExtensionUser {
  id?: string
  email: string
  firstName?: string
  lastName?: string
}

export interface ExtensionSession {
  status: 'disconnected' | 'connected' | 'refreshing'
  baseUrl: string
  accessToken: string
  refreshToken?: string
  user: ExtensionUser
  lastValidatedAt?: number
  refreshError?: string | null
}

/**
 * Session shape safe to ship to the side panel / UI code. The background
 * strips `accessToken` and `refreshToken` before returning sessions through
 * `RuntimeResponse` to keep Bearer tokens out of renderer contexts where a
 * compromised script could exfiltrate them. Storage still holds the full
 * `ExtensionSession` via `chrome.storage.local`.
 */
export type PublicExtensionSession = Omit<ExtensionSession, 'accessToken' | 'refreshToken'>

export function toPublicSession(session: ExtensionSession | null): PublicExtensionSession | null {
  if (!session) return null
  return {
    status: session.status,
    baseUrl: session.baseUrl,
    user: session.user,
    ...(session.lastValidatedAt === undefined ? {} : { lastValidatedAt: session.lastValidatedAt }),
    ...(session.refreshError === undefined ? {} : { refreshError: session.refreshError }),
  }
}

export interface ExtensionPreferences {
  baseUrl: string
  /** Ask (text chat) model (single-variant). Kept for backward compatibility. */
  modelId: string
  /**
   * Ordered list of Ask models to fan out to on a single user turn. Each
   * produces an independent assistant variant (1–4 entries). When empty or
   * absent, the runtime falls back to `[modelId]` for a single-variant turn.
   */
  askModelIds?: string[]
  /** Act planner model; falls back to `modelId` when unset. */
  actModelId?: string
  imageModelId?: string
  videoModelId?: string
  /** Default approval posture for Act runs. */
  actApprovalMode?: ActApprovalMode
  /** Default browser scope for new conversations. */
  browserScopeMode?: BrowserScopeMode
  /** Last-used generation mode for the composer (persisted across sessions). */
  generationMode?: GenerationMode
  /** Feature flag — voice recorder UI in the composer. */
  voiceEnabled?: boolean
}

/**
 * Subscription + credit snapshot mirrored from `/api/v1/subscription`.
 * Populated best-effort in the bootstrap; absent when unauthenticated or
 * when the remote fetch fails.
 */
export interface EntitlementsSnapshot {
  tier: 'free' | 'pro' | 'max'
  planKind?: 'free' | 'paid'
  isPaid: boolean
  creditsUsed?: number
  creditsTotal?: number
  fetchedAt: number
}

export interface BackendListItem {
  id: string
  title: string
  subtitle?: string
  href?: string
  kind?: string
  updatedAt?: number
}

export interface BackendParitySnapshot {
  projects: BackendListItem[]
  files: BackendListItem[]
  outputs: BackendListItem[]
  memories: BackendListItem[]
  automations: BackendListItem[]
  skills: BackendListItem[]
  mcps: BackendListItem[]
  integrations: BackendListItem[]
  settings?: Record<string, unknown> | null
  fetchedAt: number
}

/**
 * Draft attachment held in the composer before send. Images and audio are
 * inlined as data URLs; documents are uploaded through the background (which
 * stores the remote `documentId` + original file metadata).
 */
export interface AttachmentDraft {
  id: string
  name: string
  mimeType: string
  kind: 'image' | 'document' | 'audio'
  /** Data URL for image/audio drafts. Documents may omit this once indexed. */
  dataUrl?: string
  /** Byte size — used for display + size-gate enforcement. */
  sizeBytes?: number
  /** Remote document handle once server-side ingestion completes. */
  documentId?: string
  /** For documents: pending → indexed → error. */
  status?: 'uploading' | 'ready' | 'error'
  /** Human-readable error when `status === 'error'`. */
  error?: string
}

export interface MessageTextPart {
  type: 'text'
  id: string
  text: string
}

export interface MessageReasoningPart {
  type: 'reasoning'
  id: string
  text: string
  state: 'streaming' | 'done'
}

export interface MessageToolPart {
  type: 'tool'
  id: string
  toolCallId: string
  toolName: string
  state:
    | 'input-streaming'
    | 'input-available'
    | 'input-error'
    | 'output-available'
    | 'output-error'
    | 'output-denied'
  inputText?: string
  input?: unknown
  output?: unknown
  errorText?: string
  providerExecuted?: boolean
  dynamic?: boolean
  title?: string
}

export interface MessageSourcePart {
  type: 'source'
  id: string
  sourceKind: 'url' | 'document'
  sourceId: string
  url?: string
  title?: string
  mediaType?: string
  filename?: string
}

export interface MessageFilePart {
  type: 'file'
  id: string
  url: string
  mediaType: string
}

export interface MessageDataPart {
  type: 'data'
  id: string
  dataType: string
  data: unknown
  transient?: boolean
}

export type ConversationMessagePart =
  | MessageTextPart
  | MessageReasoningPart
  | MessageToolPart
  | MessageSourcePart
  | MessageFilePart
  | MessageDataPart

/**
 * A single stored message. On an Ask turn with N models, a user message
 * spawns N assistant messages that share `turnId` and differ only by
 * `variantIndex` (0-based). Legacy rows without `turnId` collapse to a
 * single-variant turn during migration.
 */
export interface ConversationMessage {
  id: string
  role: 'user' | 'assistant'
  parts: ConversationMessagePart[]
  createdAt: number
  metadata?: Record<string, unknown>
  /** Groups user message + its assistant variants. Optional for legacy rows. */
  turnId?: string
  /** 0-based variant index; absent/0 means single-variant. */
  variantIndex?: number
  /** Model that produced an assistant variant (helpful for labelling tabs). */
  modelId?: string
}

/**
 * Grouped view over `messages[]` produced by `conversationTurnsFromMessages`.
 * The runtime stores flat messages (to stay compatible with existing
 * persistence); callers project that flat list into turns for rendering.
 */
export interface ConversationTurn {
  turnId: string
  user: ConversationMessage | null
  /** Assistant variants keyed by variantIndex (may have gaps while streaming). */
  variants: ConversationMessage[]
}

export interface StoredConversation {
  id: string
  title: string
  preview: string
  updatedAt: number
  messages: ConversationMessage[]
  /** Schema version. 2 = pre-variant, 3 = variant-aware. */
  version?: 2 | 3
  /** Conversation-level browser scope override; falls back to preferences. */
  browserScope?: BrowserScopeMode
  /** Conversation-level act approval override. */
  actApprovalMode?: ActApprovalMode
  /**
   * Allowlist of tool names the user granted "approve for this conversation"
   * to. Wiped whenever a new conversation is selected (see Phase 6).
   */
  actAllowlist?: WriteClassToolName[]
}

/**
 * Project a flat message list into variant-grouped turns. Stable output even
 * when variants stream in at different speeds; user messages preserve their
 * chronological order.
 */
export function conversationTurnsFromMessages(
  messages: ConversationMessage[],
): ConversationTurn[] {
  const byTurn = new Map<string, ConversationTurn>()
  const order: string[] = []
  for (const msg of messages) {
    // Legacy rows: synthesize a per-message turnId so every message still
    // lands in its own turn.
    const turnId = msg.turnId ?? msg.id
    let turn = byTurn.get(turnId)
    if (!turn) {
      turn = { turnId, user: null, variants: [] }
      byTurn.set(turnId, turn)
      order.push(turnId)
    }
    if (msg.role === 'user') {
      turn.user = msg
    } else {
      turn.variants.push(msg)
    }
  }
  for (const turn of byTurn.values()) {
    turn.variants.sort((a, b) => (a.variantIndex ?? 0) - (b.variantIndex ?? 0))
  }
  return order.map((id) => byTurn.get(id)!).filter(Boolean)
}

export interface RuntimeBootstrap {
  capabilities: ExtensionCapabilities
  panelState: PanelRuntimeState
  session: PublicExtensionSession | null
  preferences: ExtensionPreferences
  conversations: StoredConversation[]
  activeConversationId: string | null
  pageContext: PageContextSnapshot | null
  windowTabs: WindowTabSnapshot[]
  approvals: ApprovalRequest[]
  toolHistory: ToolHistoryEntry[]
  /** In-flight runs keyed by conversation id (parallel chats across tabs). */
  activeRuns: Record<string, ActiveRunState>
  controlIndicator: ControlIndicatorState | null
  /** Cached subscription snapshot; null when unauthenticated or not yet loaded. */
  entitlements: EntitlementsSnapshot | null
  /** Compact backend-backed lists used by the side panel parity surfaces. */
  parity: BackendParitySnapshot | null
}

export interface AskResult {
  conversation: StoredConversation
  pageContext: PageContextSnapshot | null
  windowTabs: WindowTabSnapshot[]
}

export type LocalToolName =
  | 'tabs.list'
  | 'tabs.open'
  | 'tabs.focus'
  | 'tabs.close'
  | 'tabs.navigate'
  | 'tabs.reload'
  | 'windows.list'
  | 'windows.focus'
  | 'page.inspect'
  | 'page.find'
  | 'page.scroll'
  | 'page.click'
  | 'page.type'
  | 'page.press'
  | 'page.select'
  | 'page.hover'
  | 'page.wait_for'
  | 'page.screenshot'
  | 'page.click_at'
  | 'page.move_mouse'
  | 'page.drag'
  | 'browser_run_task'

export interface ToolCoordinateTarget {
  x: number
  y: number
}

export interface ToolTargetDescriptor {
  tabId?: number
  windowId?: number
  url?: string
  selector?: string
  text?: string
  coordinates?: ToolCoordinateTarget
}

export interface ApprovalRequest {
  id: string
  runId: string
  conversationId: string
  assistantMessageId: string
  toolCallId: string
  toolName: LocalToolName
  summary: string
  args: Record<string, unknown>
  createdAt: number
  status: 'pending'
  readOnly?: boolean
  target?: ToolTargetDescriptor
}

export interface ToolHistoryEntry {
  id: string
  runId?: string
  conversationId: string
  toolCallId?: string
  toolName: LocalToolName
  summary: string
  status: 'planned' | 'approved' | 'rejected' | 'completed' | 'failed'
  createdAt: number
  detail?: string
}

export interface BrowserContextEnvelope {
  pageContext: PageContextSnapshot | null
  windowTabs: WindowTabSnapshot[]
}

export interface ActPlanResult {
  approval: ApprovalRequest
  conversation: StoredConversation
  toolHistoryEntry: ToolHistoryEntry
}

export interface ActiveRunState {
  id: string
  conversationId: string
  /** Extension uses a single local act loop; value is always `act`. */
  mode: 'act'
  status: 'streaming' | 'awaiting_approval' | 'executing_tool' | 'completed' | 'failed' | 'cancelled'
  startedAt: number
  updatedAt: number
  assistantMessageId?: string
  error?: string
  stepCount?: number
  latestToolName?: LocalToolName
  controlTabId?: number
  controlWindowId?: number
  /** Browser tab that initiated this run (page behind side panel). */
  sourceTabId?: number
  /** Act only: require approval before destructive tools, or run without prompts. */
  actPolicy?: 'approval' | 'autonomous'
  /** Groups variants for a single user turn (multi-model fan-out). */
  turnId?: string
  /** 0-based variant index when multiple models answer the same turn. */
  variantIndex?: number
  /** Model that produced this variant (mirrors the assistant message). */
  modelId?: string
}

/**
 * Map key used to locate a run in `activeRuns`. Single-variant runs keep the
 * historical `conversationId` key for backward compatibility; multi-variant
 * runs (variantIndex > 0) are keyed `${conversationId}#${variantIndex}`.
 */
export function activeRunKey(conversationId: string, variantIndex?: number): string {
  if (!variantIndex) return conversationId
  return `${conversationId}#${variantIndex}`
}

export interface ControlIndicatorState {
  runId: string
  active: boolean
  label: string
  updatedAt: number
  mode: 'act'
  toolName?: LocalToolName
  tabId?: number
  windowId?: number
  targetLabel?: string
}

export type RuntimeStreamEvent =
  | {
      type: 'overlay.runtime.stream.conversation.updated'
      conversation: StoredConversation
      activeConversationId: string | null
    }
  | {
      type: 'overlay.runtime.stream.run.updated'
      conversationId: string
      /** Matches `ActiveRunState.variantIndex`; absent/0 for single-variant runs. */
      variantIndex?: number
      run: ActiveRunState | null
    }
  | {
      type: 'overlay.runtime.stream.approvals.updated'
      approvals: ApprovalRequest[]
    }
  | {
      type: 'overlay.runtime.stream.control.updated'
      controlIndicator: ControlIndicatorState | null
    }
  | {
      type: 'overlay.runtime.stream.error'
      error: string
    }

export type RuntimeRequest =
  | { type: 'overlay.runtime.ping' }
  | { type: 'overlay.runtime.bootstrap' }
  | {
      type: 'overlay.runtime.chat.start'
      conversationId: string
      prompt: string
      scope: BrowserScopeMode
      sourceTabId: number
      attachments?: AttachmentDraft[]
    }
  | { type: 'overlay.runtime.chat.stop'; conversationId: string }
  | { type: 'overlay.runtime.parity.refresh' }
  | {
      type: 'overlay.runtime.media.generate'
      conversationId: string
      prompt: string
      kind: 'image' | 'video'
      /** Attachments — first image attachment is used as `imageUrl` for image edits. */
      attachments?: AttachmentDraft[]
    }
  | { type: 'overlay.runtime.entitlements.refresh' }
  | {
      type: 'overlay.runtime.files.ingest'
      fileName: string
      mimeType: string
      /** base64-encoded file bytes (no data URL prefix). */
      base64: string
    }
  | {
      type: 'overlay.runtime.audio.transcribe'
      mimeType: string
      /** base64-encoded audio bytes (no data URL prefix). */
      base64: string
    }
  | {
      type: 'overlay.runtime.act.start'
      conversationId: string
      prompt: string
      scope: BrowserScopeMode
      sourceTabId: number
      /** Default `approval` — destructive tools wait for user approval. `autonomous` runs without prompts. */
      actPolicy?: 'approval' | 'autonomous'
      attachments?: AttachmentDraft[]
    }
  | { type: 'overlay.runtime.act.stop'; conversationId: string }
  | { type: 'overlay.runtime.session.save'; session: ExtensionSession }
  | { type: 'overlay.runtime.session.clear' }
  | { type: 'overlay.runtime.session.refresh' }
  | { type: 'overlay.runtime.preferences.save'; preferences: ExtensionPreferences }
  | { type: 'overlay.runtime.conversations.create' }
  | { type: 'overlay.runtime.conversations.delete'; conversationId: string }
  | { type: 'overlay.runtime.conversations.select'; conversationId: string }
  | {
      type: 'overlay.runtime.approval.resolve'
      approvalId: string
      /**
       * `approve-allowlist` approves this action AND adds the tool to the
       * conversation's allowlist so future calls to the same tool skip the
       * approval card. Cleared when the conversation is switched.
       */
      decision: 'approve' | 'reject' | 'approve-allowlist'
    }
  | {
      type: 'overlay.runtime.conversation.settings.save'
      conversationId: string
      settings: {
        browserScope?: BrowserScopeMode
        actApprovalMode?: ActApprovalMode
      }
    }
  | {
      type: 'overlay.runtime.bridge.capture-browser-context'
    }
  /**
   * Prepares a sign-in URL (PKCE + session transfer). Open in a browser tab;
   * after the user signs in, the account page delivers tokens via
   * `chrome.runtime.sendMessage` (externally_connectable).
   */
  | { type: 'overlay.runtime.auth.open-sign-in' }

export type RuntimeResponse =
  | { ok: true; type: 'overlay.runtime.pong'; timestamp: number }
  | { ok: true; type: 'overlay.runtime.bootstrap'; bootstrap: RuntimeBootstrap }
  | { ok: true; type: 'overlay.runtime.media.generated' }
  | { ok: true; type: 'overlay.runtime.chat.started'; runs: ActiveRunState[] }
  | { ok: true; type: 'overlay.runtime.chat.stopped' }
  | { ok: true; type: 'overlay.runtime.parity.refreshed'; parity: BackendParitySnapshot | null }
  | { ok: true; type: 'overlay.runtime.entitlements.refreshed'; entitlements: EntitlementsSnapshot | null }
  | {
      ok: true
      type: 'overlay.runtime.files.ingested'
      documentId: string
      indexedFileName: string
    }
  | { ok: true; type: 'overlay.runtime.audio.transcribed'; text: string }
  | { ok: true; type: 'overlay.runtime.act.started'; run: ActiveRunState }
  | { ok: true; type: 'overlay.runtime.act.stopped' }
  | { ok: true; type: 'overlay.runtime.session.saved'; session: PublicExtensionSession }
  | { ok: true; type: 'overlay.runtime.session.cleared' }
  | { ok: true; type: 'overlay.runtime.session.refreshed'; session: PublicExtensionSession }
  | { ok: true; type: 'overlay.runtime.preferences.saved'; preferences: ExtensionPreferences }
  | { ok: true; type: 'overlay.runtime.conversation.created'; conversation: StoredConversation }
  | { ok: true; type: 'overlay.runtime.conversation.deleted'; conversationId: string }
  | { ok: true; type: 'overlay.runtime.conversation.selected'; conversationId: string }
  | { ok: true; type: 'overlay.runtime.approval.resolved'; bootstrap: RuntimeBootstrap }
  | { ok: true; type: 'overlay.runtime.conversation.settings.saved'; conversation: StoredConversation }
  | { ok: true; type: 'overlay.runtime.bridge.browser-context'; context: BrowserContextEnvelope }
  | { ok: true; type: 'overlay.runtime.auth.open-sign-in'; url: string }
  | { ok: false; error: string }

export type WebBridgeRequest =
  | { source: 'overlay-web-app'; type: 'overlay.bridge.ping' }
  | { source: 'overlay-web-app'; type: 'overlay.bridge.get-capabilities' }
  | { source: 'overlay-web-app'; type: 'overlay.bridge.capture-browser-context' }

export type WebBridgeResponse =
  | { source: 'overlay-extension'; type: 'overlay.bridge.pong'; timestamp: number }
  | {
      source: 'overlay-extension'
      type: 'overlay.bridge.capabilities'
      capabilities: ExtensionCapabilities
    }
  | {
      source: 'overlay-extension'
      type: 'overlay.bridge.browser-context'
      context: BrowserContextEnvelope
    }
  | { source: 'overlay-extension'; type: 'overlay.bridge.error'; error: string }
