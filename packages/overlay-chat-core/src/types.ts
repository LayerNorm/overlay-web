import type { GeneratedUiPart } from './generated-ui'

export type ChatMode = 'ask' | 'act'
export type GenerationMode = 'text' | 'image' | 'video'
export type AskModelSelectionMode = 'single' | 'multiple'
export type VideoSubMode =
  | 'text-to-video'
  | 'image-to-video'
  | 'reference-to-video'
  | 'motion-control'
  | 'video-editing'

export interface Conversation {
  _id: string
  title: string
  lastModified: number
  createdAt?: number
  updatedAt?: number
  lastMode?: ChatMode
  askModelIds?: string[]
  modelIds?: string[]
  actModelId?: string
  shareVisibility?: 'private' | 'public'
  shareToken?: string | null
}

export interface AttachedImage {
  dataUrl: string
  mimeType: string
  name: string
}

export type MessageImageAttachment = {
  url: string
  name: string
  mediaType?: string
}

export interface PendingChatDocument {
  clientId: string
  name: string
  fileIds: string[]
  status: 'uploading' | 'ready' | 'error'
  error?: string
}

export interface ChatOutput {
  _id: string
  type: string
  status: 'pending' | 'completed' | 'failed'
  prompt: string
  modelId: string
  url?: string
  createdAt: number
  turnId?: string
}

export interface Entitlements {
  tier: 'free' | 'pro' | 'max'
  planKind?: 'free' | 'paid'
  creditsUsed: number
  creditsTotal: number
  budgetUsedCents?: number
  budgetTotalCents?: number
  budgetRemainingCents?: number
  autoTopUpEnabled?: boolean
  topUpAmountCents?: number
  autoTopUpAmountCents?: number
  topUpMinAmountCents?: number
  topUpMaxAmountCents?: number
  topUpStepAmountCents?: number
  dailyUsage: { ask: number; write: number; agent: number }
  dailyLimits: { ask: number; write: number; agent: number }
}

export type AssistantVisualBlock =
  | {
      kind: 'tool'
      key: string
      name: string
      state: string
      toolInput?: Record<string, unknown>
      toolOutput?: unknown
    }
  | { kind: 'text'; text: string }
  | { kind: 'file'; url: string; mediaType?: string }
  | {
      kind: 'source'
      id: string
      sourceKind: 'url' | 'document'
      sourceId: string
      url?: string
      title?: string
      mediaType?: string
      filename?: string
    }
  | { kind: 'generated-ui'; part: GeneratedUiPart }
  | { kind: 'reasoning'; key: string; text: string; state?: string }

export type ToolVisualBlock = Extract<AssistantVisualBlock, { kind: 'tool' }>
export type ReasoningVisualBlock = Extract<AssistantVisualBlock, { kind: 'reasoning' }>
export type ToolGroupItem = ToolVisualBlock | ReasoningVisualBlock

export type AssistantVisualSegment =
  | { kind: 'reasoning'; block: ReasoningVisualBlock; originIndex: number }
  | { kind: 'text'; block: Extract<AssistantVisualBlock, { kind: 'text' }>; originIndex: number }
  | { kind: 'file'; block: Extract<AssistantVisualBlock, { kind: 'file' }>; originIndex: number }
  | { kind: 'generated-ui'; block: Extract<AssistantVisualBlock, { kind: 'generated-ui' }>; originIndex: number }
  | { kind: 'browser'; block: ToolVisualBlock; originIndex: number }
  | { kind: 'tools'; items: ToolGroupItem[]; originIndex: number }

export type MentionType = 'file' | 'connector' | 'automation' | 'skill' | 'mcp' | 'chat'

export interface ChatMessageMention {
  type: MentionType
  id: string
  name: string
  fileIds?: string[]
}

export type SourceCitationMap = Record<
  string,
  { kind: 'file' | 'memory'; sourceId: string }
>

export interface WebSourceItem {
  url: string
  title: string
  snippet?: string
  origin: 'web-search' | 'browser'
}

export interface ChatMessageMetadata {
  indexedDocuments?: string[]
  indexedAttachments?: { name: string; fileIds: string[] }[]
  replyToTurnId?: string
  replySnippet?: string
  sourceCitations?: SourceCitationMap
  routedModelId?: string
  mentions?: ChatMessageMention[]
}

export interface SkillDraftSummary {
  name: string
  description: string
  instructions: string
  confidence: 'low' | 'medium' | 'high'
  detectedIntegrations: string[]
  reason: string
}

export type AutomationScheduleDraft =
  | { kind: 'interval'; intervalMinutes: number }
  | { kind: 'daily'; hourUTC: number; minuteUTC: number }
  | { kind: 'weekly'; dayOfWeekUTC: number; hourUTC: number; minuteUTC: number }
  | { kind: 'monthly'; dayOfMonthUTC: number; hourUTC: number; minuteUTC: number }

export interface AutomationDraftSummary {
  name: string
  description: string
  instructions: string
  confidence: 'low' | 'medium' | 'high'
  detectedIntegrations: string[]
  missingFields: string[]
  reason: string
  schedule: AutomationScheduleDraft
  timezone: string
  graphSource?: string
}

export type DraftModalState =
  | { kind: 'skill'; draft: SkillDraftSummary }
  | { kind: 'automation'; draft: AutomationDraftSummary }

export type ServerConversationMessage = {
  id: string
  turnId?: string
  role: 'user' | 'assistant'
  parts: Array<{
    type: string
    text?: string
    url?: string
    mediaType?: string
    fileName?: string
    state?: string
  }>
  model?: string
  metadata?: ChatMessageMetadata
  replyToTurnId?: string
  replySnippet?: string
  routedModelId?: string
}

export type LiveMessageDelta = {
  _id: string
  messageId: string
  textDelta?: string
  newParts?: Array<Record<string, unknown>>
}

export interface GenerationResult {
  type: 'image' | 'video'
  status: 'generating' | 'completed' | 'failed'
  url?: string
  modelUsed?: string
  outputId?: string
  error?: string
  upgradeRequired?: boolean
}

export interface ConversationUiState<TMessage = unknown> {
  selectedActModel: string
  selectedModels: string[]
  askModelSelectionMode: AskModelSelectionMode
  exchangeModes: ChatMode[]
  exchangeModels: string[][]
  selectedTabPerExchange: number[]
  activeChatTitle: string | null
  generationResults: Map<number, GenerationResult[]>
  exchangeGenTypes: GenerationMode[]
  isFirstMessage: boolean
  orphanModelThreads: Map<string, TMessage[]>
  lastGeneratedImageUrl: string | null
}

export interface RestoredOutputGroup {
  type: 'image' | 'video'
  prompt: string
  modelIds: string[]
  results: GenerationResult[]
  createdAt: number
  turnId?: string | null
}

export interface AttachmentDraft {
  id: string
  name: string
  mimeType: string
  kind: 'image' | 'document' | 'audio'
  dataUrl?: string
  sizeBytes?: number
  documentId?: string
  status?: 'uploading' | 'ready' | 'error'
  error?: string
}

export interface ChatModel {
  id: string
  name: string
  provider?: string
  description?: string
  intelligence?: number
  cost?: 0 | 1 | 2 | 3
  speedTier?: 1 | 2 | 3
  supportsVision?: boolean
  supportsReasoning?: boolean
  supportsSearch?: boolean
  supportsZeroDataRetention?: boolean
  pricePer1mTokens?: number
  medianOutputTokensPerSecond?: number
}

export interface ImageModel {
  id: string
  name: string
  provider?: string
  description?: string
  defaultAspectRatio?: string
}

export interface VideoModel {
  id: string
  name: string
  provider?: string
  description?: string
  billingUnit?: 'per_video' | 'per_second'
  defaultDuration?: number
  defaultAspectRatio?: string
}

export interface ChatModelPreferences {
  modelId?: string
  askModelIds?: string[]
  actModelId?: string
  imageModelId?: string
  videoModelId?: string
  generationMode?: GenerationMode
}

export type BrowserScope = 'active-tab' | 'current-window'

export interface WindowTabSnapshot {
  tabId: number
  windowId?: number
  title: string
  url?: string
  status?: string
  active?: boolean
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

export interface ConversationMessage {
  id: string
  role: 'user' | 'assistant'
  parts: ConversationMessagePart[]
  createdAt: number
  metadata?: Record<string, unknown>
  turnId?: string
  variantIndex?: number
  modelId?: string
}

export interface ActiveRunState {
  conversationId?: string
  mode?: 'act'
  status: 'streaming' | 'awaiting_approval' | 'executing_tool' | 'completed' | 'failed' | 'cancelled'
  startedAt?: number
  updatedAt?: number
  assistantMessageId?: string
  error?: string
  stepCount?: number
  latestToolName?: string
  controlTabId?: number
  controlWindowId?: number
  sourceTabId?: number
  actPolicy?: 'approval' | 'autonomous'
  turnId?: string
  variantIndex?: number
  modelId?: string
}
