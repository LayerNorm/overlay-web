import 'server-only'

import { randomBytes, randomUUID } from 'node:crypto'
import { and, asc, desc, eq, exists, gt, gte, inArray, isNull, lt, notInArray, or } from 'drizzle-orm'
import { DEFAULT_APP_SETTINGS } from '@overlay/app-core'
import type { OverlayPostgresDb } from '@/server/database/postgres/client'
import { withTransientPostgresReadRetry } from '@/server/database/postgres/transient-errors'
import {
  conversationContextSummaries,
  conversationEvents,
  conversationMessageDeltas,
  conversationMessages,
  conversations,
  automations,
  projects,
  skills,
  userSettings,
} from '@/server/database/postgres/schema'
import type { ContextSummarySnapshot } from '@/server/chat/context-compaction'
import type { AppSettings, Entitlements } from '@/shared/app/app-contracts'
import { assertActivePostgresProject } from '@/server/projects/PostgresProjectAccess'
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
  ConversationEventRow,
  ConversationMessageRow,
  SharedConversationRow,
} from './ActConversationRepository'
import { emitPostgresConversationEvent as emitConversationEvent } from './PostgresConversationEvents'
import type { PostgresConversationEventNotifier } from './PostgresConversationEventNotifier'
import { enqueueMemoryExtractionJob } from '@/server/memory/PostgresMemoryExtractionJobs'

type ConversationId = Id<'conversations'>
type ConversationMessageId = Id<'conversationMessages'>

export class PostgresActConversationRepository implements ActConversationRepository {
  constructor(
    private readonly db: OverlayPostgresDb,
    private readonly eventNotifier?: PostgresConversationEventNotifier,
    private readonly options: { memoryExtractionEnabled?: boolean } = {},
  ) {}

  async createConversation(args: {
    actModelId: string
    askModelIds: string[]
    clientId?: string
    lastMode?: 'ask' | 'act'
    projectId?: string
    title: string
    userId: string
    workspaceId?: string
    conversationType?: 'personal' | 'dm' | 'channel'
    createdByPrincipalId?: string
    isAutomation?: boolean
    workspaceId?: string
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
      isAutomation: args.isAutomation ?? false,
      workspaceId: args.workspaceId,
    }

    const [row] = await this.db.transaction(async (tx) => {
      let [workspace] = args.workspaceId
        ? await tx.select().from(workspaces).where(and(
            eq(workspaces.id, args.workspaceId),
            eq(workspaces.status, 'active'),
          )).limit(1)
        : await tx.select().from(workspaces).where(and(
            eq(workspaces.kind, 'personal'),
            eq(workspaces.personalOwnerUserId, args.userId),
            eq(workspaces.status, 'active'),
          )).limit(1)
      let principal
      if (!workspace && !args.workspaceId) {
        const workspaceId = `workspace_${randomUUID()}`
        const principalId = `principal_${randomUUID()}`
        ;[workspace] = await tx.insert(workspaces).values({
          id: workspaceId,
          kind: 'personal',
          name: 'Personal',
          slug: `personal-${randomUUID()}`,
          status: 'active',
          personalOwnerUserId: args.userId,
          createdAt: now,
          updatedAt: now,
        }).returning()
        ;[principal] = await tx.insert(workspacePrincipals).values({
          id: principalId,
          workspaceId,
          type: 'human',
          userId: args.userId,
          displayName: 'Member',
          createdAt: now,
          updatedAt: now,
        }).returning()
        await tx.insert(workspaceMemberships).values({
          workspaceId,
          principalId,
          role: 'owner',
          status: 'active',
          joinedAt: now,
          updatedAt: now,
        })
        await tx.update(workspaces)
          .set({ createdByPrincipalId: principalId, updatedAt: now })
          .where(eq(workspaces.id, workspaceId))
      }
      if (!workspace) throw new Error('WORKSPACE_ACCESS_DENIED')
      if (!principal) {
        ;[principal] = await tx.select().from(workspacePrincipals).where(and(
          eq(workspacePrincipals.workspaceId, workspace.id),
          eq(workspacePrincipals.userId, args.userId),
          eq(workspacePrincipals.type, 'human'),
          isNull(workspacePrincipals.archivedAt),
        )).limit(1)
      }
      if (!principal || (args.createdByPrincipalId && args.createdByPrincipalId !== principal.id)) {
        throw new Error('WORKSPACE_ACCESS_DENIED')
      }
      const [membership] = await tx.select().from(workspaceMemberships).where(and(
        eq(workspaceMemberships.workspaceId, workspace.id),
        eq(workspaceMemberships.principalId, principal.id),
        eq(workspaceMemberships.status, 'active'),
      )).limit(1)
      if (!membership) throw new Error('WORKSPACE_ACCESS_DENIED')
      const values = {
        id,
        workspaceId: workspace.id,
        conversationType: args.conversationType ?? 'personal' as const,
        createdByPrincipalId: principal.id,
        userId: args.userId,
        clientId: normalizeOptional(args.clientId),
        title: args.title,
        projectId: normalizeOptional(args.projectId),
        askModelIds: args.askModelIds,
        actModelId: args.actModelId,
        lastMode: args.lastMode ?? 'act' as const,
        lastModified: now,
        createdAt: now,
        updatedAt: now,
        isAutomation: args.isAutomation ?? false,
      }
      await assertActivePostgresProject(tx, {
        projectId: values.projectId,
        userId: args.userId,
      })
      const inserted = values.clientId
        ? await tx
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
                isAutomation: values.isAutomation,
                updatedAt: now,
              },
            })
            .returning({ id: conversations.id })
        : await tx
            .insert(conversations)
            .values(values)
            .returning({ id: conversations.id })
      const created = inserted[0]
      if (created?.id) {
        await emitConversationEvent(tx, {
          conversationId: created.id,
          type: 'conversation.created',
          userId: args.userId,
        })
      }
      return inserted
    })

    if (!row?.id) throw new Error('Failed to create conversation')
    return row.id as ConversationId
  }

  async getConversationById(args: {
    conversationId: ConversationId
    userId: string
    workspaceId?: string
  }): Promise<ConversationListRow | null> {
    const [row] = await this.db
      .select()
      .from(conversations)
      .where(and(
        eq(conversations.id, args.conversationId),
        eq(conversations.userId, args.userId),
        args.workspaceId ? eq(conversations.workspaceId, args.workspaceId) : undefined,
      ))
      .limit(1)
    return row ? mapConversationRow(row) : null
  }

  async listConversations(args: {
    includeDeleted?: boolean
    updatedSince?: number
    userId: string
    workspaceId?: string
  }): Promise<ConversationListRow[]> {
    const linkedAutomationConversationIds = await listLinkedAutomationConversationIds(this.db, args.userId)
    const rows = await this.db
      .select()
      .from(conversations)
      .where(conversationListWhere({
        includeDeleted: args.includeDeleted,
        updatedSince: args.updatedSince,
        userId: args.userId,
        workspaceId: args.workspaceId,
        conversationType: args.conversationType,
        linkedAutomationConversationIds,
        workspaceId: args.workspaceId,
      }))
      .orderBy(desc(conversations.lastModified))
    return rows.map(mapConversationRow)
  }

  async listConversationsByProject(args: {
    includeDeleted?: boolean
    projectId: string
    updatedSince?: number
    userId: string
    workspaceId?: string
  }): Promise<ConversationListRow[]> {
    const linkedAutomationConversationIds = await listLinkedAutomationConversationIds(this.db, args.userId)
    const rows = await this.db
      .select()
      .from(conversations)
      .where(and(
        conversationListWhere({
          includeDeleted: args.includeDeleted,
          updatedSince: args.updatedSince,
          userId: args.userId,
          workspaceId: args.workspaceId,
          linkedAutomationConversationIds,
          workspaceId: args.workspaceId,
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
    projectId?: string | null
    title?: string
    userId: string
    workspaceId?: string
  }): Promise<void> {
    const now = new Date()
    await this.db.transaction(async (tx) => {
      if (args.projectId !== undefined) {
        await assertActivePostgresProject(tx, {
          projectId: args.projectId,
          userId: args.userId,
        })
      }
      const updated = await tx
        .update(conversations)
        .set({
          ...(args.actModelId !== undefined ? { actModelId: args.actModelId } : {}),
          ...(args.askModelIds !== undefined ? { askModelIds: args.askModelIds } : {}),
          ...(args.lastMode !== undefined ? { lastMode: args.lastMode } : {}),
          ...(args.projectId !== undefined ? { projectId: normalizeNullable(args.projectId) } : {}),
          ...(args.title !== undefined ? { title: args.title } : {}),
          lastModified: now,
          updatedAt: now,
        })
        .where(and(
          eq(conversations.id, args.conversationId),
          eq(conversations.userId, args.userId),
          args.workspaceId ? eq(conversations.workspaceId, args.workspaceId) : undefined,
        ))
        .returning({ id: conversations.id })
      if (updated.length > 0) {
        await emitConversationEvent(tx, {
          conversationId: args.conversationId,
          type: 'conversation.updated',
          userId: args.userId,
        })
      }
    })
  }

  async deleteConversation(args: {
    conversationId: ConversationId
    userId: string
    workspaceId?: string
  }): Promise<void> {
    const now = new Date()
    await this.db.transaction(async (tx) => {
      const updated = await tx
        .update(conversations)
        .set({
          deletedAt: now,
          lastModified: now,
          updatedAt: now,
        })
        .where(and(
          eq(conversations.id, args.conversationId),
          eq(conversations.userId, args.userId),
          args.workspaceId ? eq(conversations.workspaceId, args.workspaceId) : undefined,
        ))
        .returning({ id: conversations.id })
      if (updated.length > 0) {
        await emitConversationEvent(tx, {
          conversationId: args.conversationId,
          type: 'conversation.deleted',
          userId: args.userId,
        })
      }
    })
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
        replyToTurnId: args.replyToTurnId,
        replySnippet: args.replySnippet,
        tokens: args.tokens,
        routedModelId: args.routedModelId,
        status: 'completed',
        createdAt: now,
        updatedAt: now,
      })
      await touchConversation(tx, args.conversationId, args.userId, now, args.mode)
      await emitConversationEvent(tx, {
        conversationId: args.conversationId,
        messageId: id,
        type: 'message.created',
        userId: args.userId,
      })
      if (
        args.role === 'user' &&
        args.skipMemoryExtraction !== true &&
        this.options.memoryExtractionEnabled !== false
      ) {
        await enqueueMemoryExtractionJob(tx, {
          conversationId: args.conversationId,
          messageId: id,
          turnId: args.turnId,
          userId: args.userId,
        })
      }
    })
    return id
  }

  async listMemories(): Promise<ActMemoryRow[] | null> {
    return []
  }

  async listSkills(args: { userId: string }): Promise<ActSkillRow[]> {
    return await this.db
      .select({
        enabled: skills.enabled,
        instructions: skills.instructions,
        name: skills.name,
      })
      .from(skills)
      .where(and(eq(skills.userId, args.userId), isNull(skills.projectId)))
      .orderBy(desc(skills.updatedAt))
      .limit(200)
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
      await emitConversationEvent(tx, {
        conversationId: args.conversationId,
        messageId: id,
        type: 'message.created',
        userId: args.userId,
      })
    })
    return id
  }

  async appendGeneratingMessageDelta(args: {
    messageId: ConversationMessageId
    newParts?: Array<Record<string, unknown>>
    textDelta?: string
  }): Promise<boolean> {
    return await this.db.transaction(async (tx) => {
      const [row] = await tx
        .select({
          content: conversationMessages.content,
          conversationId: conversationMessages.conversationId,
          parts: conversationMessages.parts,
          status: conversationMessages.status,
          userId: conversationMessages.userId,
        })
        .from(conversationMessages)
        .where(eq(conversationMessages.id, args.messageId))
        .limit(1)
        .for('update')
      if (!row || row.status !== 'generating') return false

      const now = new Date()
      const nextParts = args.newParts?.length
        ? [...((row.parts as Array<Record<string, unknown>> | null) ?? []), ...args.newParts]
        : row.parts
      const deltaId = messageDeltaId()
      await tx.insert(conversationMessageDeltas).values({
        id: deltaId,
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
        .where(and(
          eq(conversationMessages.id, args.messageId),
          eq(conversationMessages.status, 'generating'),
        ))
      await touchConversation(tx, row.conversationId as ConversationId, row.userId, now, 'act')
      await emitConversationEvent(tx, {
        conversationId: row.conversationId,
        messageId: args.messageId,
        payload: { deltaId },
        type: 'message.delta',
        userId: row.userId,
      })
      return true
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
    await this.db.transaction(async (tx) => {
      const [row] = await tx
        .update(conversationMessages)
        .set({
          content: args.content,
          parts: args.parts,
          routedModelId: args.routedModelId,
          tokens: args.tokens,
          status: 'completed',
          updatedAt: now,
        })
        .where(and(
          eq(conversationMessages.id, args.messageId),
          eq(conversationMessages.status, 'generating'),
        ))
        .returning({
          conversationId: conversationMessages.conversationId,
          mode: conversationMessages.mode,
          userId: conversationMessages.userId,
        })
      if (row) {
        await touchConversation(tx, row.conversationId as ConversationId, row.userId, now, row.mode)
        await emitConversationEvent(tx, {
          conversationId: row.conversationId,
          messageId: args.messageId,
          type: 'message.completed',
          userId: row.userId,
        })
      }
    })
  }

  async failGeneratingMessage(args: {
    errorText: string
    messageId: ConversationMessageId
  }): Promise<void> {
    const now = new Date()
    await this.db.transaction(async (tx) => {
      const [row] = await tx
        .update(conversationMessages)
        .set({
          content: args.errorText,
          parts: [{ type: 'text', text: args.errorText }],
          status: 'error',
          updatedAt: now,
        })
        .where(and(
          eq(conversationMessages.id, args.messageId),
          eq(conversationMessages.status, 'generating'),
        ))
        .returning({
          conversationId: conversationMessages.conversationId,
          mode: conversationMessages.mode,
          userId: conversationMessages.userId,
        })
      if (row) {
        await touchConversation(tx, row.conversationId as ConversationId, row.userId, now, row.mode)
        await emitConversationEvent(tx, {
          conversationId: row.conversationId,
          messageId: args.messageId,
          type: 'message.failed',
          userId: row.userId,
        })
      }
    })
  }

  async settleGeneratingMessagesForTurn(args: {
    conversationId: ConversationId
    fallbackText: string
    status: 'completed' | 'error'
    turnId: string
    userId: string
  }): Promise<void> {
    const now = new Date()
    await this.db.transaction(async (tx) => {
      const rows = await tx
        .update(conversationMessages)
        .set({
          content: args.fallbackText,
          parts: [{ type: 'text', text: args.fallbackText }],
          status: args.status,
          updatedAt: now,
        })
        .where(and(
          eq(conversationMessages.conversationId, args.conversationId),
          eq(conversationMessages.userId, args.userId),
          eq(conversationMessages.turnId, args.turnId),
          eq(conversationMessages.status, 'generating'),
        ))
        .returning({ id: conversationMessages.id })
      for (const row of rows) {
        await emitConversationEvent(tx, {
          conversationId: args.conversationId,
          messageId: row.id,
          type: args.status === 'completed' ? 'message.completed' : 'message.failed',
          userId: args.userId,
        })
      }
      if (rows.length > 0) {
        await touchConversation(tx, args.conversationId, args.userId, now, 'act')
      }
    })
  }

  async stopGeneratingMessages(args: {
    conversationId: ConversationId
    messageId?: ConversationMessageId
    partialContent?: string
    partialParts?: Array<Record<string, unknown>>
    userId: string
  }): Promise<{ stoppedCount: number }> {
    return await this.db.transaction(async (tx) => {
      const [conversation] = await tx
        .select({ id: conversations.id })
        .from(conversations)
        .where(and(
          eq(conversations.id, args.conversationId),
          eq(conversations.userId, args.userId),
          isNull(conversations.deletedAt),
        ))
        .limit(1)
      if (!conversation) throw new Error('Unauthorized')

      const rows = await tx
        .select()
        .from(conversationMessages)
        .where(and(
          eq(conversationMessages.conversationId, args.conversationId),
          eq(conversationMessages.userId, args.userId),
          eq(conversationMessages.status, 'generating'),
          args.messageId ? eq(conversationMessages.id, args.messageId) : undefined,
        ))
        .for('update')
      if (rows.length === 0) return { stoppedCount: 0 }

      const now = new Date()
      const sentinel = '\n\n[Interrupted by user. Continue?]'
      for (const row of rows) {
        const baseContent = args.partialContent ?? row.content
        const content = `${baseContent.trimEnd()}${sentinel}`
        const baseParts = args.partialParts?.length
          ? args.partialParts
          : (row.parts as Array<Record<string, unknown>> | null) ?? [{ type: 'text', text: baseContent }]
        await tx
          .update(conversationMessages)
          .set({
            content,
            parts: [...baseParts, { type: 'text', text: sentinel }],
            status: 'completed',
            updatedAt: now,
          })
          .where(eq(conversationMessages.id, row.id))
        await tx
          .delete(conversationMessageDeltas)
          .where(eq(conversationMessageDeltas.messageId, row.id))
        await emitConversationEvent(tx, {
          conversationId: args.conversationId,
          messageId: row.id,
          type: 'message.stopped',
          userId: args.userId,
        })
      }
      await touchConversation(tx, args.conversationId, args.userId, now, rows[0]?.mode ?? 'act')
      return { stoppedCount: rows.length }
    })
  }

  async deleteTurn(args: {
    conversationId: ConversationId
    turnId: string
    userId: string
  }): Promise<{ deletedMessages: number }> {
    return await this.db.transaction(async (tx) => {
      const [conversation] = await tx
        .select({ id: conversations.id })
        .from(conversations)
        .where(and(
          eq(conversations.id, args.conversationId),
          eq(conversations.userId, args.userId),
          isNull(conversations.deletedAt),
        ))
        .limit(1)
      if (!conversation) throw new Error('Unauthorized')

      const messages = await tx
        .select({ id: conversationMessages.id })
        .from(conversationMessages)
        .where(and(
          eq(conversationMessages.conversationId, args.conversationId),
          eq(conversationMessages.userId, args.userId),
          eq(conversationMessages.turnId, args.turnId),
        ))
      if (messages.length > 0) {
        await tx
          .delete(conversationMessages)
          .where(inArray(conversationMessages.id, messages.map((message) => message.id)))
      }
      const now = new Date()
      await touchConversation(tx, args.conversationId, args.userId, now, 'act')
      await emitConversationEvent(tx, {
        conversationId: args.conversationId,
        payload: { deletedMessages: messages.length, turnId: args.turnId },
        type: 'message.deleted',
        userId: args.userId,
      })
      return { deletedMessages: messages.length }
    })
  }

  async updateMessageUiPart(args: {
    conversationId: ConversationId
    messageId: ConversationMessageId
    partId: string
    data: Record<string, unknown>
    userId: string
  }): Promise<boolean> {
    return await this.db.transaction(async (tx) => {
      const [message] = await tx
        .select({ parts: conversationMessages.parts })
        .from(conversationMessages)
        .where(and(
          eq(conversationMessages.id, args.messageId),
          eq(conversationMessages.conversationId, args.conversationId),
          eq(conversationMessages.userId, args.userId),
        ))
        .limit(1)
      if (!message) return false
      let found = false
      const parts = ((message.parts as Array<Record<string, unknown>> | null) ?? []).map((part) => {
        if (part.id !== args.partId) return part
        found = true
        return { ...part, data: args.data }
      })
      if (!found) return false
      const now = new Date()
      await tx
        .update(conversationMessages)
        .set({ parts, updatedAt: now })
        .where(eq(conversationMessages.id, args.messageId))
      await touchConversation(tx, args.conversationId, args.userId, now, 'act')
      await emitConversationEvent(tx, {
        conversationId: args.conversationId,
        messageId: args.messageId,
        type: 'message.ui-updated',
        userId: args.userId,
      })
      return true
    })
  }

  async setShare(args: {
    conversationId: ConversationId
    userId: string
    visibility: 'private' | 'public'
  }): Promise<{ token: string | null; visibility: 'private' | 'public' } | null> {
    return await this.db.transaction(async (tx) => {
      const [conversation] = await tx
        .select({ shareToken: conversations.shareToken })
        .from(conversations)
        .where(and(
          eq(conversations.id, args.conversationId),
          eq(conversations.userId, args.userId),
          isNull(conversations.deletedAt),
        ))
        .limit(1)
      if (!conversation) return null
      const now = new Date()
      const token = args.visibility === 'public'
        ? conversation.shareToken ?? generateShareToken()
        : generateShareToken()
      await tx
        .update(conversations)
        .set({
          shareToken: token,
          shareVisibility: args.visibility,
          ...(args.visibility === 'public' ? { sharedAt: now } : {}),
          updatedAt: now,
        })
        .where(eq(conversations.id, args.conversationId))
      await emitConversationEvent(tx, {
        conversationId: args.conversationId,
        payload: { visibility: args.visibility },
        type: 'conversation.shared',
        userId: args.userId,
      })
      return {
        token: args.visibility === 'public' ? token : null,
        visibility: args.visibility,
      }
    })
  }

  async getPublicConversationByToken(args: {
    token: string
  }): Promise<SharedConversationRow | null> {
    const [conversation] = await this.db
      .select()
      .from(conversations)
      .where(and(
        eq(conversations.shareToken, args.token),
        eq(conversations.shareVisibility, 'public'),
        isNull(conversations.deletedAt),
      ))
      .limit(1)
    if (!conversation) return null
    const messages = await this.db
      .select()
      .from(conversationMessages)
      .where(eq(conversationMessages.conversationId, conversation.id))
      .orderBy(asc(conversationMessages.createdAt))
    return {
      _id: conversation.id,
      title: conversation.title,
      createdAt: toMillis(conversation.createdAt),
      sharedAt: toMillis(conversation.sharedAt ?? conversation.updatedAt ?? conversation.createdAt),
      messages: messages.map(mapConversationMessageRow),
    }
  }

  async getConversationEventCursor(args: { userId: string }): Promise<number> {
    return await withTransientPostgresReadRetry(async () => {
      const [event] = await this.db
        .select({ sequence: conversationEvents.sequence })
        .from(conversationEvents)
        .where(eq(conversationEvents.userId, args.userId))
        .orderBy(desc(conversationEvents.sequence))
        .limit(1)
      return event?.sequence ?? 0
    })
  }

  async listConversationEvents(args: {
    afterSequence: number
    limit: number
    userId: string
  }): Promise<ConversationEventRow[]> {
    return await withTransientPostgresReadRetry(async () => {
      const rows = await this.db
        .select()
        .from(conversationEvents)
        .where(and(
          eq(conversationEvents.userId, args.userId),
          gt(conversationEvents.sequence, args.afterSequence),
        ))
        .orderBy(asc(conversationEvents.sequence))
        .limit(Math.max(1, Math.min(200, Math.floor(args.limit))))
      return rows.map((row) => ({
        sequence: row.sequence,
        conversationId: row.conversationId,
        type: row.type as ConversationEventRow['type'],
        messageId: row.messageId ?? undefined,
        payload: row.payload ?? undefined,
        createdAt: toMillis(row.createdAt),
      }))
    })
  }

  async waitForConversationEvents(args: {
    afterSequence: number
    limit: number
    signal?: AbortSignal
    timeoutMs: number
    userId: string
  }): Promise<ConversationEventRow[]> {
    const deadline = Date.now() + Math.max(1, args.timeoutMs)
    while (!args.signal?.aborted) {
      let events = await this.listConversationEvents(args)
      if (events.length > 0 || !this.eventNotifier) return events

      const remainingMs = deadline - Date.now()
      if (remainingMs <= 0) return []
      const listenerConnected = this.eventNotifier.getHealth().connected
      const waiter = await this.eventNotifier.createWaiter({
        signal: args.signal,
        // LISTEN is only a wake-up optimization. While disconnected, check the
        // durable cursor every second so recovery never depends on a process restart.
        timeoutMs: Math.min(remainingMs, listenerConnected ? remainingMs : 1_000),
        userId: args.userId,
      })
      events = await this.listConversationEvents(args)
      if (events.length > 0) {
        waiter.cancel()
        return events
      }
      await waiter.promise
    }
    return []
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
  linkedAutomationConversationIds: string[]
  updatedSince?: number
  userId: string
  workspaceId?: string
}) {
  return and(
    eq(conversations.userId, args.userId),
    or(isNull(conversations.isAutomation), eq(conversations.isAutomation, false)),
    args.linkedAutomationConversationIds.length > 0
      ? notInArray(conversations.id, args.linkedAutomationConversationIds)
      : undefined,
    or(isNull(conversations.isAutomation), eq(conversations.isAutomation, false)),
    args.linkedAutomationConversationIds.length > 0
      ? notInArray(conversations.id, args.linkedAutomationConversationIds)
      : undefined,
    args.includeDeleted ? undefined : isNull(conversations.deletedAt),
    finiteDate(args.updatedSince)
      ? or(
          gte(conversations.lastModified, finiteDate(args.updatedSince)!),
          gte(conversations.updatedAt, finiteDate(args.updatedSince)!),
        )
      : undefined,
    args.workspaceId ? eq(conversations.workspaceId, args.workspaceId) : undefined,
  )
}

async function listLinkedAutomationConversationIds(
  db: OverlayPostgresDb,
  userId: string,
): Promise<string[]> {
  const rows = await db
    .select({
      sourceConversationId: automations.sourceConversationId,
      conversationId: automations.conversationId,
    })
    .from(automations)
    .where(and(
      eq(automations.userId, userId),
      isNull(automations.deletedAt),
    ))
  return [...new Set(rows.flatMap((row) => [row.sourceConversationId, row.conversationId].filter(
    (id): id is string => Boolean(id),
  )))]
}

async function listLinkedAutomationConversationIds(
  db: OverlayPostgresDb,
  userId: string,
): Promise<string[]> {
  const rows = await db
    .select({
      sourceConversationId: automations.sourceConversationId,
      conversationId: automations.conversationId,
    })
    .from(automations)
    .where(and(
      eq(automations.userId, userId),
      isNull(automations.deletedAt),
    ))
  return [...new Set(rows.flatMap((row) => [row.sourceConversationId, row.conversationId].filter(
    (id): id is string => Boolean(id),
  )))]
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
    shareVisibility: row.shareVisibility ?? undefined,
    shareToken: row.shareToken,
    isAutomation: row.isAutomation ?? undefined,
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

function normalizeNullable(value: string | null): string | null {
  return value?.trim() || null
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

function generateShareToken(): string {
  return randomBytes(16).toString('base64url')
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
