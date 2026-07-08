import 'server-only'

import { randomUUID } from 'node:crypto'
import { and, desc, eq, gte, isNull, lt, or } from 'drizzle-orm'
import { DEFAULT_APP_SETTINGS } from '@overlay/app-core'
import type { OverlayPostgresDb } from '@/server/database/postgres/client'
import {
  conversationContextSummaries,
  conversationMessageDeltas,
  conversationMessages,
  conversations,
  projects,
  userSettings,
} from '@/server/database/postgres/schema'
import type { ContextSummarySnapshot } from '@/server/chat/context-compaction'
import type { AppSettings, Entitlements } from '@/shared/app/app-contracts'
import type { Id } from '../../../convex/_generated/dataModel'
import type {
  ActConversationRepository,
  ActConversationRow,
  ActMemoryRow,
  ActPersistedMessage,
  ActProjectRow,
  ActSkillRow,
  ActUsageEvent,
  ConversationListRow,
  ConversationMessageRow,
} from './ActConversationRepository'

type ConversationId = Id<'conversations'>
type ConversationMessageId = Id<'conversationMessages'>

export class PostgresActConversationRepository implements ActConversationRepository {
  constructor(private readonly db: OverlayPostgresDb) {}

  async createConversation(args: {
    actModelId: string
    askModelIds: string[]
    clientId?: string
    lastMode?: 'ask' | 'act'
    projectId?: string
    title: string
    userId: string
  }): Promise<ConversationId> {
    const now = new Date()
    const id = conversationId()
    const values = {
      id,
      userId: args.userId,
      clientId: normalizeOptional(args.clientId),
      title: args.title,
      projectId: normalizeOptional(args.projectId),
      askModelIds: args.askModelIds,
      actModelId: args.actModelId,
      lastMode: args.lastMode ?? 'act',
      lastModified: now,
      createdAt: now,
      updatedAt: now,
    }

    const [row] = values.clientId
      ? await this.db
          .insert(conversations)
          .values(values)
          .onConflictDoUpdate({
            target: [conversations.userId, conversations.clientId],
            set: {
              actModelId: values.actModelId,
              askModelIds: values.askModelIds,
              lastMode: values.lastMode,
              lastModified: now,
              projectId: values.projectId,
              title: values.title,
              updatedAt: now,
            },
          })
          .returning({ id: conversations.id })
      : await this.db
          .insert(conversations)
          .values(values)
          .returning({ id: conversations.id })

    if (!row?.id) throw new Error('Failed to create conversation')
    return row.id as ConversationId
  }

  async getConversationById(args: {
    conversationId: ConversationId
    userId: string
  }): Promise<ConversationListRow | null> {
    const [row] = await this.db
      .select()
      .from(conversations)
      .where(and(
        eq(conversations.id, args.conversationId),
        eq(conversations.userId, args.userId),
      ))
      .limit(1)
    return row ? mapConversationRow(row) : null
  }

  async listConversations(args: {
    includeDeleted?: boolean
    updatedSince?: number
    userId: string
  }): Promise<ConversationListRow[]> {
    const rows = await this.db
      .select()
      .from(conversations)
      .where(conversationListWhere({
        includeDeleted: args.includeDeleted,
        updatedSince: args.updatedSince,
        userId: args.userId,
      }))
      .orderBy(desc(conversations.lastModified))
    return rows.map(mapConversationRow)
  }

  async listConversationsByProject(args: {
    includeDeleted?: boolean
    projectId: string
    updatedSince?: number
    userId: string
  }): Promise<ConversationListRow[]> {
    const rows = await this.db
      .select()
      .from(conversations)
      .where(and(
        conversationListWhere({
          includeDeleted: args.includeDeleted,
          updatedSince: args.updatedSince,
          userId: args.userId,
        }),
        eq(conversations.projectId, args.projectId),
      ))
      .orderBy(desc(conversations.lastModified))
    return rows.map(mapConversationRow)
  }

  async getRecentMessages(args: {
    beforeCreatedAt?: number
    compactToolPayloads?: boolean
    conversationId: ConversationId
    limit: number
    userId: string
  }): Promise<ConversationMessageRow[]> {
    const limit = Math.max(1, Math.min(100, Math.floor(args.limit)))
    const beforeCreatedAt = finiteDate(args.beforeCreatedAt)
    const filters = [
      eq(conversationMessages.conversationId, args.conversationId),
      eq(conversationMessages.userId, args.userId),
      beforeCreatedAt ? lt(conversationMessages.createdAt, beforeCreatedAt) : undefined,
    ].filter(Boolean)

    const rows = await this.db
      .select()
      .from(conversationMessages)
      .where(and(...filters))
      .orderBy(desc(conversationMessages.createdAt))
      .limit(limit)

    return rows.reverse().map(mapConversationMessageRow)
  }

  async getConversationMessages(args: {
    conversationId: ConversationId
    userId: string
  }): Promise<ConversationMessageRow[]> {
    const rows = await this.db
      .select()
      .from(conversationMessages)
      .where(and(
        eq(conversationMessages.conversationId, args.conversationId),
        eq(conversationMessages.userId, args.userId),
      ))
      .orderBy(conversationMessages.createdAt)
    return rows.map(mapConversationMessageRow)
  }

  async updateConversation(args: {
    actModelId?: string
    askModelIds?: string[]
    conversationId: ConversationId
    lastMode?: 'ask' | 'act'
    projectId?: string
    title?: string
    userId: string
  }): Promise<void> {
    const now = new Date()
    await this.db
      .update(conversations)
      .set({
        ...(args.actModelId !== undefined ? { actModelId: args.actModelId } : {}),
        ...(args.askModelIds !== undefined ? { askModelIds: args.askModelIds } : {}),
        ...(args.lastMode !== undefined ? { lastMode: args.lastMode } : {}),
        ...(args.projectId !== undefined ? { projectId: normalizeOptional(args.projectId) } : {}),
        ...(args.title !== undefined ? { title: args.title } : {}),
        lastModified: now,
        updatedAt: now,
      })
      .where(and(
        eq(conversations.id, args.conversationId),
        eq(conversations.userId, args.userId),
      ))
  }

  async deleteConversation(args: {
    conversationId: ConversationId
    userId: string
  }): Promise<void> {
    const now = new Date()
    await this.db
      .update(conversations)
      .set({
        deletedAt: now,
        lastModified: now,
        updatedAt: now,
      })
      .where(and(
        eq(conversations.id, args.conversationId),
        eq(conversations.userId, args.userId),
      ))
  }

  async getEntitlements(): Promise<Entitlements | null> {
    return null
  }

  async getAppSettings(args: {
    userId: string
  }): Promise<AppSettings | null> {
    const [row] = await this.db
      .select()
      .from(userSettings)
      .where(eq(userSettings.userId, args.userId))
      .limit(1)
    if (!row) return DEFAULT_APP_SETTINGS
    return {
      theme: row.theme === 'dark' ? 'dark' : 'light',
      lightThemePreset: (row.lightThemePreset ?? DEFAULT_APP_SETTINGS.lightThemePreset) as AppSettings['lightThemePreset'],
      darkThemePreset: (row.darkThemePreset ?? DEFAULT_APP_SETTINGS.darkThemePreset) as AppSettings['darkThemePreset'],
      chatStreamingMode: row.chatStreamingMode === 'token' ? 'token' : DEFAULT_APP_SETTINGS.chatStreamingMode,
      autoContinue: row.autoContinue ?? DEFAULT_APP_SETTINGS.autoContinue,
      defaultChatMode: row.defaultChatMode ?? DEFAULT_APP_SETTINGS.defaultChatMode,
      modelPreference: row.modelPreference === 'different-for-each-chat'
        ? 'different-for-each-chat'
        : DEFAULT_APP_SETTINGS.modelPreference,
      defaultAskModelIds: row.defaultAskModelIds ?? DEFAULT_APP_SETTINGS.defaultAskModelIds,
      defaultActModelId: row.defaultActModelId ?? undefined,
      defaultImageModelId: row.defaultImageModelId ?? undefined,
      defaultVideoModelId: row.defaultVideoModelId ?? undefined,
      defaultImageAspectRatio: row.defaultImageAspectRatio ?? undefined,
      defaultVideoAspectRatio: row.defaultVideoAspectRatio ?? undefined,
      sendWithEnter: row.sendWithEnter ?? DEFAULT_APP_SETTINGS.sendWithEnter,
      attachFilesToKnowledgeByDefault: row.attachFilesToKnowledgeByDefault ?? DEFAULT_APP_SETTINGS.attachFilesToKnowledgeByDefault,
      onlyAllowZdrModels: row.onlyAllowZdrModels ?? DEFAULT_APP_SETTINGS.onlyAllowZdrModels,
      dismissedZdrWarningGlobally: row.dismissedZdrWarningGlobally ?? DEFAULT_APP_SETTINGS.dismissedZdrWarningGlobally,
      dismissedZdrWarningModelIds: row.dismissedZdrWarningModelIds ?? DEFAULT_APP_SETTINGS.dismissedZdrWarningModelIds,
      enabledChatModelIds: row.enabledChatModelIds ?? DEFAULT_APP_SETTINGS.enabledChatModelIds,
    }
  }

  async getMessages(args: {
    conversationId: ConversationId
    userId: string
  }): Promise<ActPersistedMessage[]> {
    const rows = await this.db
      .select()
      .from(conversationMessages)
      .where(and(
        eq(conversationMessages.conversationId, args.conversationId),
        eq(conversationMessages.userId, args.userId),
      ))
      .orderBy(conversationMessages.createdAt)
    return rows.map((row) => ({
      _id: row.id,
      turnId: row.turnId,
      role: row.role,
      modelId: row.modelId ?? undefined,
      content: row.content,
      parts: row.parts as ActPersistedMessage['parts'],
      routedModelId: row.routedModelId ?? undefined,
    }))
  }

  async addMessage(args: {
    conversationId: ConversationId
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
  }): Promise<ConversationMessageId | null> {
    const now = new Date()
    const id = messageId()
    await this.db.transaction(async (tx) => {
      await tx.insert(conversationMessages).values({
        id,
        conversationId: args.conversationId,
        userId: args.userId,
        turnId: args.turnId,
        role: args.role,
        mode: args.mode,
        content: args.content,
        contentType: args.contentType,
        parts: args.parts,
        modelId: args.modelId,
        variantIndex: args.variantIndex,
        tokens: args.tokens,
        routedModelId: args.routedModelId,
        status: 'completed',
        createdAt: now,
        updatedAt: now,
      })
      await touchConversation(tx, args.conversationId, args.userId, now, args.mode)
    })
    return id
  }

  async listMemories(): Promise<ActMemoryRow[] | null> {
    return []
  }

  async listSkills(): Promise<ActSkillRow[]> {
    return []
  }

  async getConversation(args: {
    conversationId: ConversationId
    userId: string
  }): Promise<ActConversationRow | null> {
    const row = await this.getConversationById(args)
    if (!row) return null
    return {
      _id: row._id,
      projectId: row.projectId,
    }
  }

  async getProject(args: {
    projectId: Id<'projects'>
    userId: string
  }): Promise<ActProjectRow | null> {
    const [row] = await this.db
      .select({ instructions: projects.instructions })
      .from(projects)
      .where(and(
        eq(projects.id, args.projectId),
        eq(projects.userId, args.userId),
        isNull(projects.deletedAt),
      ))
      .limit(1)
    return row ? { instructions: row.instructions ?? undefined } : null
  }

  async getContextSummary(args: {
    conversationId: ConversationId
    scope: string
    userId: string
  }): Promise<ContextSummarySnapshot | null> {
    const [row] = await this.db
      .select()
      .from(conversationContextSummaries)
      .where(and(
        eq(conversationContextSummaries.conversationId, args.conversationId),
        eq(conversationContextSummaries.userId, args.userId),
        eq(conversationContextSummaries.scope, args.scope),
      ))
      .limit(1)
    if (!row) return null
    return {
      summary: row.summary,
      summarizedThroughMessageId: row.summarizedThroughMessageId ?? undefined,
      summarizedThroughCreatedAt: row.summarizedThroughCreatedAt
        ? row.summarizedThroughCreatedAt.getTime()
        : undefined,
    }
  }

  async upsertContextSummary(args: {
    contextWindow: number
    conversationId: ConversationId
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
    const now = new Date()
    await this.db
      .insert(conversationContextSummaries)
      .values({
        id: contextSummaryId(),
        conversationId: args.conversationId,
        userId: args.userId,
        scope: args.scope,
        summary: args.summary,
        summarizedThroughMessageId: args.summarizedThroughMessageId,
        summarizedThroughCreatedAt: finiteDate(args.summarizedThroughCreatedAt),
        sourceMessageCount: args.sourceMessageCount,
        sourceEstimatedTokens: args.sourceEstimatedTokens,
        summaryEstimatedTokens: args.summaryEstimatedTokens,
        contextWindow: args.contextWindow,
        targetModelId: args.targetModelId,
        summarizerModelId: args.summarizerModelId,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [conversationContextSummaries.conversationId, conversationContextSummaries.scope],
        set: {
          summary: args.summary,
          summarizedThroughMessageId: args.summarizedThroughMessageId,
          summarizedThroughCreatedAt: finiteDate(args.summarizedThroughCreatedAt),
          sourceMessageCount: args.sourceMessageCount,
          sourceEstimatedTokens: args.sourceEstimatedTokens,
          summaryEstimatedTokens: args.summaryEstimatedTokens,
          contextWindow: args.contextWindow,
          targetModelId: args.targetModelId,
          summarizerModelId: args.summarizerModelId,
          updatedAt: now,
        },
      })
  }

  async startGeneratingMessage(args: {
    conversationId: ConversationId
    mode: 'act'
    modelId: string
    turnId: string
    userId: string
    variantIndex?: number
  }): Promise<ConversationMessageId | null> {
    const now = new Date()
    const id = messageId()
    await this.db.transaction(async (tx) => {
      await tx.insert(conversationMessages).values({
        id,
        conversationId: args.conversationId,
        userId: args.userId,
        turnId: args.turnId,
        role: 'assistant',
        mode: args.mode,
        content: '',
        contentType: 'text',
        modelId: args.modelId,
        variantIndex: args.variantIndex,
        status: 'generating',
        createdAt: now,
        updatedAt: now,
      })
      await touchConversation(tx, args.conversationId, args.userId, now, args.mode)
    })
    return id
  }

  async appendGeneratingMessageDelta(args: {
    messageId: ConversationMessageId
    newParts?: Array<Record<string, unknown>>
    textDelta?: string
  }): Promise<void> {
    const [row] = await this.db
      .select({
        content: conversationMessages.content,
        conversationId: conversationMessages.conversationId,
        parts: conversationMessages.parts,
        userId: conversationMessages.userId,
      })
      .from(conversationMessages)
      .where(eq(conversationMessages.id, args.messageId))
      .limit(1)
    if (!row) return

    const now = new Date()
    const nextParts = args.newParts?.length
      ? [...((row.parts as Array<Record<string, unknown>> | null) ?? []), ...args.newParts]
      : row.parts
    await this.db.transaction(async (tx) => {
      await tx.insert(conversationMessageDeltas).values({
        id: messageDeltaId(),
        conversationId: row.conversationId,
        messageId: args.messageId,
        userId: row.userId,
        textDelta: args.textDelta,
        newParts: args.newParts,
        createdAt: now,
      })
      await tx
        .update(conversationMessages)
        .set({
          content: `${row.content}${args.textDelta ?? ''}`,
          parts: nextParts,
          updatedAt: now,
        })
        .where(eq(conversationMessages.id, args.messageId))
      await touchConversation(tx, row.conversationId as ConversationId, row.userId, now, 'act')
    })
  }

  async finalizeGeneratingMessage(args: {
    content: string
    messageId: ConversationMessageId
    parts: Array<Record<string, unknown>>
    routedModelId?: string
    tokens: { input: number; output: number }
  }): Promise<void> {
    const now = new Date()
    const [row] = await this.db
      .update(conversationMessages)
      .set({
        content: args.content,
        parts: args.parts,
        routedModelId: args.routedModelId,
        tokens: args.tokens,
        status: 'completed',
        updatedAt: now,
      })
      .where(eq(conversationMessages.id, args.messageId))
      .returning({
        conversationId: conversationMessages.conversationId,
        mode: conversationMessages.mode,
        userId: conversationMessages.userId,
      })
    if (row) {
      await touchConversation(this.db, row.conversationId as ConversationId, row.userId, now, row.mode)
    }
  }

  async failGeneratingMessage(args: {
    errorText: string
    messageId: ConversationMessageId
  }): Promise<void> {
    const now = new Date()
    const [row] = await this.db
      .update(conversationMessages)
      .set({
        content: args.errorText,
        parts: [{ type: 'text', text: args.errorText }],
        status: 'error',
        updatedAt: now,
      })
      .where(eq(conversationMessages.id, args.messageId))
      .returning({
        conversationId: conversationMessages.conversationId,
        mode: conversationMessages.mode,
        userId: conversationMessages.userId,
      })
    if (row) {
      await touchConversation(this.db, row.conversationId as ConversationId, row.userId, now, row.mode)
    }
  }

  async recordUsageBatch(_args: {
    events: ActUsageEvent[]
    forceFreeTierLimits: boolean
    userId: string
  }): Promise<void> {
    throw new Error('Postgres usage accounting is not implemented. Configure billing.provider=none to use UnlimitedUsagePolicy.')
  }
}

function conversationListWhere(args: {
  includeDeleted?: boolean
  updatedSince?: number
  userId: string
}) {
  return and(
    eq(conversations.userId, args.userId),
    args.includeDeleted ? undefined : isNull(conversations.deletedAt),
    finiteDate(args.updatedSince)
      ? or(
          gte(conversations.lastModified, finiteDate(args.updatedSince)!),
          gte(conversations.updatedAt, finiteDate(args.updatedSince)!),
        )
      : undefined,
  )
}

function mapConversationRow(row: typeof conversations.$inferSelect): ConversationListRow {
  return {
    _id: row.id,
    userId: row.userId,
    clientId: row.clientId ?? undefined,
    title: row.title,
    lastModified: toMillis(row.lastModified),
    createdAt: toMillis(row.createdAt),
    updatedAt: toMillis(row.updatedAt ?? row.lastModified),
    deletedAt: row.deletedAt ? toMillis(row.deletedAt) : undefined,
    lastMode: row.lastMode,
    askModelIds: row.askModelIds ?? [],
    actModelId: row.actModelId,
    projectId: row.projectId ?? undefined,
  }
}

function mapConversationMessageRow(row: typeof conversationMessages.$inferSelect): ConversationMessageRow {
  return {
    _id: row.id,
    turnId: row.turnId,
    role: row.role,
    mode: row.mode,
    content: row.content,
    contentType: row.contentType,
    parts: row.parts as Array<Record<string, unknown>> | undefined,
    modelId: row.modelId ?? undefined,
    variantIndex: row.variantIndex ?? undefined,
    createdAt: toMillis(row.createdAt),
    replyToTurnId: row.replyToTurnId ?? undefined,
    replySnippet: row.replySnippet ?? undefined,
    routedModelId: row.routedModelId ?? undefined,
    status: row.status ?? undefined,
  }
}

function finiteDate(value: number | undefined): Date | undefined {
  if (value === undefined || !Number.isFinite(value)) return undefined
  return new Date(value)
}

function normalizeOptional(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed || undefined
}

function toMillis(value: Date): number {
  return value.getTime()
}

function conversationId(): ConversationId {
  return `conv_${randomUUID()}` as ConversationId
}

function messageId(): ConversationMessageId {
  return `msg_${randomUUID()}` as ConversationMessageId
}

function messageDeltaId(): string {
  return `delta_${randomUUID()}`
}

function contextSummaryId(): string {
  return `ctx_${randomUUID()}`
}

async function touchConversation(
  db: Pick<OverlayPostgresDb, 'update'>,
  conversationId: ConversationId,
  userId: string,
  now: Date,
  lastMode: 'ask' | 'act',
): Promise<void> {
  await db
    .update(conversations)
    .set({
      lastMode,
      lastModified: now,
      updatedAt: now,
    })
    .where(and(
      eq(conversations.id, conversationId),
      eq(conversations.userId, userId),
    ))
}
