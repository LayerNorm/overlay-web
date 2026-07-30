import 'server-only'

import { lazyConvex as convex } from '@/server/database/lazy-convex'
import { getInternalApiSecret } from '@/server/shared/internal-api-secret'
import type {
  ActConversationRepository,
  ActConversationRow,
  ConversationListRow,
  ConversationEventRow,
  ConversationMessageRow,
  ActMemoryRow,
  ActPersistedMessage,
  ActProjectRow,
  ActSkillRow,
  ActUsageEvent,
  SharedConversationRow,
} from './ActConversationRepository'
import type { ContextSummarySnapshot } from '@/server/chat/context-compaction'
import type { AppSettings, Entitlements } from '@/shared/app/app-contracts'
import type { Id } from '../../../convex/_generated/dataModel'

export class ConvexActConversationRepository implements ActConversationRepository {
  private get serverSecret(): string {
    return getInternalApiSecret()
  }

  async createConversation(args: {
    actModelId: string
    askModelIds: string[]
    clientId?: string
    lastMode?: 'ask' | 'act'
    projectId?: string
    title: string
    userId: string
  }): Promise<Id<'conversations'>> {
    const id = await convex.mutation<Id<'conversations'>>('chat/conversations:create', {
      ...args,
      serverSecret: this.serverSecret,
    }, { throwOnError: true })
    if (!id) throw new Error('Failed to create conversation')
    return id
  }

  async getConversationById(args: {
    conversationId: Id<'conversations'>
    userId: string
  }): Promise<ConversationListRow | null> {
    return await convex.query<ConversationListRow | null>('chat/conversations:get', {
      ...args,
      serverSecret: this.serverSecret,
    })
  }

  async listConversations(args: {
    includeDeleted?: boolean
    updatedSince?: number
    userId: string
  }): Promise<ConversationListRow[]> {
    return await convex.query<ConversationListRow[]>('chat/conversations:list', {
      ...args,
      serverSecret: this.serverSecret,
    }) ?? []
  }

  async listConversationsByProject(args: {
    includeDeleted?: boolean
    projectId: string
    updatedSince?: number
    userId: string
  }): Promise<ConversationListRow[]> {
    return await convex.query<ConversationListRow[]>('chat/conversations:listByProject', {
      ...args,
      serverSecret: this.serverSecret,
    }) ?? []
  }

  async getRecentMessages(args: {
    beforeCreatedAt?: number
    compactToolPayloads?: boolean
    conversationId: Id<'conversations'>
    limit: number
    userId: string
  }): Promise<ConversationMessageRow[]> {
    return await convex.query<ConversationMessageRow[]>('chat/conversations:getRecentMessages', {
      ...args,
      serverSecret: this.serverSecret,
    }) ?? []
  }

  async getConversationMessages(args: {
    conversationId: Id<'conversations'>
    userId: string
  }): Promise<ConversationMessageRow[]> {
    return await convex.query<ConversationMessageRow[]>('chat/conversations:getMessages', {
      ...args,
      serverSecret: this.serverSecret,
    }, { throwOnError: true }) ?? []
  }

  async updateConversation(args: {
    actModelId?: string
    askModelIds?: string[]
    conversationId: Id<'conversations'>
    lastMode?: 'ask' | 'act'
    projectId?: string | null
    title?: string
    userId: string
  }): Promise<void> {
    await convex.mutation('chat/conversations:update', {
      ...args,
      serverSecret: this.serverSecret,
    }, { throwOnError: true })
  }

  async deleteConversation(args: {
    conversationId: Id<'conversations'>
    userId: string
  }): Promise<void> {
    await convex.mutation('chat/conversations:remove', {
      ...args,
      serverSecret: this.serverSecret,
    }, { throwOnError: true })
  }

  async getEntitlements(args: {
    userId: string
  }): Promise<Entitlements | null> {
    return await convex.query<Entitlements | null>('platform/usage:getEntitlementsByServer', {
      userId: args.userId,
      serverSecret: this.serverSecret,
    })
  }

  async getAppSettings(args: {
    userId: string
  }): Promise<AppSettings | null> {
    return await convex.query<AppSettings | null>('platform/uiSettings:getByServer', {
      userId: args.userId,
      serverSecret: this.serverSecret,
    })
  }

  async getMessages(args: {
    conversationId: Id<'conversations'>
    userId: string
  }): Promise<ActPersistedMessage[]> {
    return await convex.query<ActPersistedMessage[]>('chat/conversations:getMessages', {
      conversationId: args.conversationId,
      userId: args.userId,
      serverSecret: this.serverSecret,
    }, { throwOnError: true }) ?? []
  }

  async addMessage(args: {
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
    workspaceId?: string
    authorKind?: 'human' | 'agent' | 'model' | 'system'
    authorPrincipalId?: string
    clientNonce?: string
    threadRootMessageId?: string
    variantIndex?: number
  }): Promise<Id<'conversationMessages'> | null> {
    return await convex.mutation<Id<'conversationMessages'> | null>('chat/conversations:addMessage', {
      ...args,
      serverSecret: this.serverSecret,
    })
  }

  async listMemories(args: {
    userId: string
  }): Promise<ActMemoryRow[] | null> {
    return await convex.query<ActMemoryRow[]>('knowledge/memories:list', {
      userId: args.userId,
      serverSecret: this.serverSecret,
    })
  }

  async listSkills(args: {
    userId: string
  }): Promise<ActSkillRow[]> {
    return await convex.query<ActSkillRow[]>('integrations/skills:list', {
      userId: args.userId,
      serverSecret: this.serverSecret,
    }) ?? []
  }

  async getConversation(args: {
    conversationId: Id<'conversations'>
    userId: string
  }): Promise<ActConversationRow | null> {
    return await convex.query<ActConversationRow | null>('chat/conversations:get', {
      conversationId: args.conversationId,
      userId: args.userId,
      serverSecret: this.serverSecret,
    })
  }

  async getProject(args: {
    projectId: Id<'projects'>
    userId: string
  }): Promise<ActProjectRow | null> {
    return await convex.query<ActProjectRow | null>('projects/projects:get', {
      projectId: args.projectId,
      userId: args.userId,
      serverSecret: this.serverSecret,
    })
  }

  async getContextSummary(args: {
    conversationId: Id<'conversations'>
    scope: string
    userId: string
  }): Promise<ContextSummarySnapshot | null> {
    return await convex.query<ContextSummarySnapshot | null>('chat/conversations:getContextSummary', {
      conversationId: args.conversationId,
      scope: args.scope,
      userId: args.userId,
      serverSecret: this.serverSecret,
    })
  }

  async upsertContextSummary(args: {
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
  }): Promise<void> {
    await convex.mutation('chat/conversations:upsertContextSummary', {
      ...args,
      serverSecret: this.serverSecret,
    })
  }

  async startGeneratingMessage(args: {
    conversationId: Id<'conversations'>
    mode: 'act'
    modelId: string
    turnId: string
    userId: string
    variantIndex?: number
  }): Promise<Id<'conversationMessages'> | null> {
    return await convex.mutation<Id<'conversationMessages'> | null>('chat/conversations:startGeneratingMessage', {
      ...args,
      serverSecret: this.serverSecret,
    }) ?? null
  }

  async appendGeneratingMessageDelta(args: {
    messageId: Id<'conversationMessages'>
    newParts?: Array<Record<string, unknown>>
    textDelta?: string
  }): Promise<boolean> {
    await convex.mutation('chat/conversations:appendGeneratingMessageDelta', {
      ...args,
      serverSecret: this.serverSecret,
    })
    return true
  }

  async finalizeGeneratingMessage(args: {
    content: string
    messageId: Id<'conversationMessages'>
    parts: Array<Record<string, unknown>>
    routedModelId?: string
    tokens: { input: number; output: number }
  }): Promise<void> {
    await convex.mutation('chat/conversations:finalizeGeneratingMessage', {
      ...args,
      serverSecret: this.serverSecret,
    })
  }

  async failGeneratingMessage(args: {
    errorText: string
    messageId: Id<'conversationMessages'>
  }): Promise<void> {
    await convex.mutation('chat/conversations:failGeneratingMessage', {
      ...args,
      serverSecret: this.serverSecret,
    })
  }

  async settleGeneratingMessagesForTurn(args: {
    conversationId: Id<'conversations'>
    fallbackText: string
    status: 'completed' | 'error'
    turnId: string
    userId: string
  }): Promise<void> {
    await convex.mutation('chat/conversations:settleGeneratingMessagesForTurn', {
      ...args,
      serverSecret: this.serverSecret,
    }, { throwOnError: true })
  }

  async stopGeneratingMessages(args: {
    conversationId: Id<'conversations'>
    messageId?: Id<'conversationMessages'>
    partialContent?: string
    partialParts?: Array<Record<string, unknown>>
    userId: string
  }): Promise<{ stoppedCount: number }> {
    return await convex.mutation<{ stoppedCount: number }>('chat/conversations:stopGeneratingMessage', {
      ...args,
      serverSecret: this.serverSecret,
    }, { throwOnError: true }) ?? { stoppedCount: 0 }
  }

  async deleteTurn(args: {
    conversationId: Id<'conversations'>
    turnId: string
    userId: string
  }): Promise<{ deletedMessages: number }> {
    const result = await convex.mutation<{ deletedMessages: number }>('chat/conversations:deleteTurn', {
      ...args,
      serverSecret: this.serverSecret,
    }, { throwOnError: true })
    return { deletedMessages: result?.deletedMessages ?? 0 }
  }

  async updateMessageUiPart(args: {
    conversationId: Id<'conversations'>
    messageId: Id<'conversationMessages'>
    partId: string
    data: Record<string, unknown>
    userId: string
  }): Promise<boolean> {
    await convex.mutation('chat/conversations:updateMessageUiPart', {
      ...args,
      serverSecret: this.serverSecret,
    }, { throwOnError: true })
    return true
  }

  async setShare(args: {
    conversationId: Id<'conversations'>
    userId: string
    visibility: 'private' | 'public'
  }): Promise<{ token: string | null; visibility: 'private' | 'public' } | null> {
    return await convex.mutation('chat/conversations:setShare', {
      ...args,
      serverSecret: this.serverSecret,
    }, { throwOnError: true })
  }

  async getPublicConversationByToken(args: { token: string }): Promise<SharedConversationRow | null> {
    return await convex.query<SharedConversationRow | null>('chat/conversations:getPublicByToken', args)
  }

  async getConversationEventCursor(_args: { userId: string; workspaceId?: string }): Promise<number> {
    return 0
  }

  async listConversationEvents(_args: {
    afterSequence: number
    limit: number
    userId: string
    workspaceId?: string
  }): Promise<ConversationEventRow[]> {
    return []
  }

  async waitForConversationEvents(_args: {
    afterSequence: number
    limit: number
    signal?: AbortSignal
    timeoutMs: number
    userId: string
    workspaceId?: string
  }): Promise<ConversationEventRow[]> {
    return []
  }

  async recordUsageBatch(args: {
    events: ActUsageEvent[]
    forceFreeTierLimits: boolean
    userId: string
  }): Promise<void> {
    await convex.mutation('platform/usage:recordBatch', {
      ...args,
      serverSecret: this.serverSecret,
    })
  }
}
