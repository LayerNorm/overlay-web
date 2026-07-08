import 'server-only'

import { lazyConvex as convex } from '@/server/database/lazy-convex'
import { getInternalApiSecret } from '@/server/shared/internal-api-secret'
import type {
  ActConversationRepository,
  ActConversationRow,
  ActMemoryRow,
  ActPersistedMessage,
  ActProjectRow,
  ActSkillRow,
  ActUsageEvent,
} from './ActConversationRepository'
import type { ContextSummarySnapshot } from '@/server/chat/context-compaction'
import type { AppSettings, Entitlements } from '@/shared/app/app-contracts'
import type { Id } from '../../../convex/_generated/dataModel'

export class ConvexActConversationRepository implements ActConversationRepository {
  private get serverSecret(): string {
    return getInternalApiSecret()
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
    contentType: 'text'
    mode: 'act'
    modelId: string
    parts?: Array<Record<string, unknown>>
    role: 'user' | 'assistant'
    routedModelId?: string
    skipMemoryExtraction?: boolean
    tokens?: { input: number; output: number }
    turnId: string
    userId: string
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
  }): Promise<void> {
    await convex.mutation('chat/conversations:appendGeneratingMessageDelta', {
      ...args,
      serverSecret: this.serverSecret,
    })
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
