import type { UIMessage } from '@/shared/chat/ai-ui-message'
import type { Chat } from '@/components/providers/ai-chat-client'
import type { SourceCitationMap } from '@/shared/knowledge/ask-knowledge-types'
import type { OutputType } from '@/shared/tools/output-types'
import type { GeneratedUiPart } from '@overlay/chat-core/generated-ui'
import type { AutomationDraftSummary } from '@/features/automations/lib/automation-drafts'
import type { SkillDraftSummary } from '@/features/automations/lib/skill-drafts'
import type { Id } from '../../../../../convex/_generated/dataModel'

export interface Conversation {
  _id: string
  title: string
  lastModified: number
  createdAt?: number
  updatedAt?: number
  lastMode?: 'ask' | 'act'
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

export interface PendingChatDocument {
  clientId: string
  name: string
  /** Convex file row ids (all parts when a long upload was split). */
  fileIds: string[]
  status: 'uploading' | 'ready' | 'error'
  error?: string
}

export interface ChatOutput {
  _id: string
  type: OutputType
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

export interface ChatMessageMetadata {
  indexedDocuments?: string[]
  indexedAttachments?: { name: string; fileIds: string[] }[]
  replyToTurnId?: string
  replySnippet?: string
  sourceCitations?: SourceCitationMap
  routedModelId?: string
  mentions?: ChatMessageMention[]
}

export type DraftModalState = {
  kind: 'skill'
  draft: SkillDraftSummary
} | {
  kind: 'automation'
  draft: AutomationDraftSummary
}

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

export type LiveConversationMessage = {
  _id: Id<'conversationMessages'>
  turnId: string
  role: 'user' | 'assistant'
  mode: 'ask' | 'act'
  content: string
  contentType: 'text' | 'image' | 'video'
  parts?: Array<Record<string, unknown>>
  modelId?: string
  variantIndex?: number
  routedModelId?: string
  status?: 'generating' | 'completed' | 'error'
}

export type LiveMessageDelta = {
  _id: Id<'conversationMessageDeltas'>
  messageId: Id<'conversationMessages'>
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

export type AskModelSelectionMode = 'single' | 'multiple'

export interface ConversationUiState {
  selectedActModel: string
  selectedModels: string[]
  askModelSelectionMode: AskModelSelectionMode
  exchangeModes: ('ask' | 'act')[]
  exchangeModels: string[][]
  selectedTabPerExchange: number[]
  activeChatTitle: string | null
  generationResults: Map<number, GenerationResult[]>
  exchangeGenTypes: ('text' | 'image' | 'video')[]
  isFirstMessage: boolean
  orphanModelThreads: Map<string, UIMessage[]>
  lastGeneratedImageUrl: string | null
}

export interface ConversationRuntime {
  askChats: [Chat<UIMessage>, Chat<UIMessage>, Chat<UIMessage>, Chat<UIMessage>]
  actChat: Chat<UIMessage>
  hydrated: boolean
  ui: ConversationUiState
}

export interface RestoredOutputGroup {
  type: 'image' | 'video'
  prompt: string
  modelIds: string[]
  results: GenerationResult[]
  createdAt: number
  turnId?: string | null
}
