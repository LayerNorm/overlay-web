import 'server-only'

import type { UIMessage } from '@/server/ai/sdk'
import type { ContextSummarySnapshot } from '@/server/chat/context-compaction'
import type { AppSettings, Entitlements } from '@/shared/app/app-contracts'
import type { Id } from '../../../convex/_generated/dataModel'

export type ActPersistedMessage = {
  _id: string
  turnId: string
  role: 'user' | 'assistant'
  modelId?: string
  content: string
  parts?: UIMessage['parts']
  routedModelId?: string
}

export type ActMemoryRow = {
  content: string
  importance?: number
  updatedAt?: number
}

export type ActSkillRow = {
  name: string
  instructions: string
  enabled?: boolean
}

export type ActConversationRow = {
  _id?: string
  projectId?: string
}

export type ActProjectRow = {
  instructions?: string
  archivedAt?: number
  settings?: Record<string, unknown>
}

export type ConversationListRow = {
  _id: string
  userId: string
  clientId?: string
  title: string
  lastModified: number
  createdAt: number
  updatedAt: number
  deletedAt?: number
  lastMode: 'ask' | 'act'
  askModelIds: string[]
  actModelId: string
  projectId?: string
  shareVisibility?: 'private' | 'public'
  shareToken?: string | null
  isAutomation?: boolean
  conversationType?: 'personal' | 'dm' | 'channel'
  workspaceId?: string
}

export type ConversationMessageRow = {
  _id: string
  turnId: string
  role: 'user' | 'assistant'
  mode: 'ask' | 'act'
  content: string
  contentType: 'text' | 'image' | 'video'
  parts?: Array<Record<string, unknown>>
  modelId?: string
  variantIndex?: number
  createdAt: number
  replyToTurnId?: string
  replySnippet?: string
  routedModelId?: string
  status?: 'generating' | 'completed' | 'error'
  clientNonce?: string
  deletedAt?: number
  authorPrincipalId?: string
  authorKind?: 'human' | 'agent' | 'model' | 'system'
  editedAt?: number
  editHistory?: Array<{
    content: string
    editedAt: number
  }>
  threadRootMessageId?: string
}

export type ActUsageEvent = {
  type: 'agent'
  modelId: string
  inputTokens: number
  outputTokens: number
  cachedTokens: number
  cost: number
  timestamp: number
}

export type ConversationEventType =
  | 'conversation.created'
  | 'conversation.updated'
  | 'conversation.deleted'
  | 'conversation.shared'
  | 'message.created'
  | 'message.delta'
  | 'message.completed'
  | 'message.failed'
  | 'message.stopped'
  | 'message.deleted'
  | 'message.ui-updated'
  | 'pin.changed'
  | 'reaction.changed'

export type ConversationEventRow = {
  sequence: number
  conversationId: string
  type: ConversationEventType
  messageId?: string
  payload?: Record<string, unknown>
  createdAt: number
}

export type SharedConversationRow = {
  _id: string
  title: string
  createdAt: number
  sharedAt: number
  messages: ConversationMessageRow[]
}

export interface ActConversationRepository {
  createConversation(args: {
    actModelId: string
    askModelIds: string[]
    clientId?: string
    lastMode?: 'ask' | 'act'
    projectId?: string
    title: string
    userId: string
    isAutomation?: boolean
    workspaceId?: string
    conversationType?: 'personal' | 'dm' | 'channel'
    createdByPrincipalId?: string
  }): Promise<Id<'conversations'>>
  getConversationById(args: {
    conversationId: Id<'conversations'>
    userId: string
    workspaceId?: string
  }): Promise<ConversationListRow | null>
  listConversations(args: {
    includeDeleted?: boolean
    updatedSince?: number
    userId: string
    workspaceId?: string
  }): Promise<ConversationListRow[]>
  listConversationsByProject(args: {
    includeDeleted?: boolean
    projectId: string
    updatedSince?: number
    userId: string
    workspaceId?: string
  }): Promise<ConversationListRow[]>
  getRecentMessages(args: {
    beforeCreatedAt?: number
    compactToolPayloads?: boolean
    conversationId: Id<'conversations'>
    limit: number
    userId: string
  }): Promise<ConversationMessageRow[]>
  getConversationMessages(args: {
    conversationId: Id<'conversations'>
    userId: string
  }): Promise<ConversationMessageRow[]>
  updateConversation(args: {
    actModelId?: string
    askModelIds?: string[]
    conversationId: Id<'conversations'>
    lastMode?: 'ask' | 'act'
    projectId?: string | null
    title?: string
    userId: string
    workspaceId?: string
  }): Promise<void>
  deleteConversation(args: {
    conversationId: Id<'conversations'>
    userId: string
    workspaceId?: string
  }): Promise<void>
  getEntitlements(args: {
    userId: string
  }): Promise<Entitlements | null>
  getAppSettings(args: {
    userId: string
  }): Promise<AppSettings | null>
  getMessages(args: {
    conversationId: Id<'conversations'>
    userId: string
  }): Promise<ActPersistedMessage[]>
  addMessage(args: {
    conversationId: Id<'conversations'>
    content: string
    contentType: 'text' | 'image' | 'video'
    mode: 'ask' | 'act'
    modelId?: string
    parts?: Array<Record<string, unknown>>
    role: 'user' | 'assistant'
    replySnippet?: string
    replyToTurnId?: string
    routedModelId?: string
    skipMemoryExtraction?: boolean
    tokens?: { input: number; output: number }
    turnId: string
    userId: string
    variantIndex?: number
    workspaceId?: string
    authorKind?: 'human' | 'agent' | 'model' | 'system'
    authorPrincipalId?: string
    clientNonce?: string
    threadRootMessageId?: string
  }): Promise<Id<'conversationMessages'> | null>
  listMemories(args: {
    userId: string
  }): Promise<ActMemoryRow[] | null>
  listSkills(args: {
    userId: string
  }): Promise<ActSkillRow[]>
  getConversation(args: {
    conversationId: Id<'conversations'>
    userId: string
  }): Promise<ActConversationRow | null>
  getProject(args: {
    projectId: Id<'projects'>
    userId: string
  }): Promise<ActProjectRow | null>
  getContextSummary(args: {
    conversationId: Id<'conversations'>
    scope: string
    userId: string
  }): Promise<ContextSummarySnapshot | null>
  upsertContextSummary(args: {
    contextWindow: number
    conversationId: Id<'conversations'>
    scope: string
    sourceEstimatedTokens: number
    sourceMessageCount: number
    summarizedThroughCreatedAt?: number
    summarizedThroughMessageId?: string
    summarizerModelId: string
    summary: string
    summaryEstimatedTokens: number
    targetModelId: string
    userId: string
  }): Promise<void>
  startGeneratingMessage(args: {
    conversationId: Id<'conversations'>
    mode: 'act'
    modelId: string
    turnId: string
    userId: string
    variantIndex?: number
  }): Promise<Id<'conversationMessages'> | null>
  appendGeneratingMessageDelta(args: {
    messageId: Id<'conversationMessages'>
    newParts?: Array<Record<string, unknown>>
    textDelta?: string
  }): Promise<boolean>
  finalizeGeneratingMessage(args: {
    content: string
    messageId: Id<'conversationMessages'>
    parts: Array<Record<string, unknown>>
    routedModelId?: string
    tokens: { input: number; output: number }
  }): Promise<void>
  failGeneratingMessage(args: {
    errorText: string
    messageId: Id<'conversationMessages'>
  }): Promise<void>
  settleGeneratingMessagesForTurn(args: {
    conversationId: Id<'conversations'>
    fallbackText: string
    status: 'completed' | 'error'
    turnId: string
    userId: string
  }): Promise<void>
  stopGeneratingMessages(args: {
    conversationId: Id<'conversations'>
    messageId?: Id<'conversationMessages'>
    partialContent?: string
    partialParts?: Array<Record<string, unknown>>
    userId: string
  }): Promise<{ stoppedCount: number }>
  deleteTurn(args: {
    conversationId: Id<'conversations'>
    turnId: string
    userId: string
  }): Promise<{ deletedMessages: number }>
  updateMessageUiPart(args: {
    conversationId: Id<'conversations'>
    messageId: Id<'conversationMessages'>
    partId: string
    data: Record<string, unknown>
    userId: string
  }): Promise<boolean>
  setShare(args: {
    conversationId: Id<'conversations'>
    userId: string
    visibility: 'private' | 'public'
  }): Promise<{ token: string | null; visibility: 'private' | 'public' } | null>
  getPublicConversationByToken(args: {
    token: string
  }): Promise<SharedConversationRow | null>
  getConversationEventCursor(args: {
    userId: string
  }): Promise<number>
  listConversationEvents(args: {
    afterSequence: number
    limit: number
    userId: string
  }): Promise<ConversationEventRow[]>
  waitForConversationEvents(args: {
    afterSequence: number
    limit: number
    signal?: AbortSignal
    timeoutMs: number
    userId: string
  }): Promise<ConversationEventRow[]>
  recordUsageBatch(args: {
    events: ActUsageEvent[]
    forceFreeTierLimits: boolean
    userId: string
  }): Promise<void>
}
