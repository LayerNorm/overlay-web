import 'server-only'

import { createHash, randomUUID } from 'node:crypto'
import { and, desc, eq, gt, ilike, inArray, isNotNull, isNull, lt, or } from 'drizzle-orm'
import { DEFAULT_MODEL_ID } from '@/shared/ai/gateway/model-types'
import type { OverlayPostgresDb } from '@/server/database/postgres/client'
import {
  conversationEvents,
  conversationMessageReactions,
  conversationMessages,
  conversationParticipants,
  conversationPins,
  conversationSavedMessages,
  conversationThreadFollows,
  conversations,
  workspaceMemberships,
  workspaceNotifications,
  workspaceNotificationPreferences,
  workspacePresence,
  workspacePrincipals,
  workspaceResourceScopes,
  workspaces,
} from '@/server/database/postgres/schema'
import type {
  ChannelSummary,
  ConversationPin,
  ConversationParticipant,
  ConversationPresence,
  ConversationSavedMessage,
  DirectMessageSummary,
  MessageReaction,
  WorkspaceChatSearchResult,
  WorkspaceNotification,
  WorkspaceNotificationFilter,
  WorkspaceNotificationPreferences,
  ConversationThreadFollow,
} from '@overlay/workspace-contracts'
import type { ConversationCollaborationRepository } from './ConversationCollaborationRepository'
import { emitPostgresConversationEvent as emitConversationEvent } from './PostgresConversationEvents'
import { resolveConversationActivityState } from '@/shared/chat/conversation-activity-state'
import type {
  ConversationEventRow,
  ConversationListRow,
  ConversationMessageRow,
} from './ActConversationRepository'

export class PostgresConversationCollaborationRepository
implements ConversationCollaborationRepository {
  constructor(private readonly db: OverlayPostgresDb) {}

  async getAccessibleConversation(args: {
    actorUserId: string
    conversationId: string
    workspaceId: string
  }): Promise<ConversationListRow | null> {
    if (!await this.canAccessConversation(args)) return null
    const [row] = await this.db.select().from(conversations).where(and(
      eq(conversations.id, args.conversationId),
      eq(conversations.workspaceId, args.workspaceId),
      isNull(conversations.deletedAt),
    )).limit(1)
    return row ? mapAccessibleConversation(row) : null
  }

  async listAccessibleConversations(args: {
    actorUserId: string
    workspaceId: string
  }): Promise<ConversationListRow[]> {
    const ids = await this.listAccessibleConversationIds(args)
    if (ids.length === 0) return []
    const rows = await this.db.select().from(conversations).where(and(
      inArray(conversations.id, ids),
      eq(conversations.workspaceId, args.workspaceId),
      isNull(conversations.deletedAt),
      isNull(conversations.projectId),
    )).orderBy(desc(conversations.lastModified))
    return rows.filter((row) => !row.isAutomation).map(mapAccessibleConversation)
  }

  async listArchivedConversations(args: {
    actorUserId: string
    workspaceId: string
  }): Promise<ConversationListRow[]> {
    const actor = await this.requireActor(args)
    const archived = await this.db
      .select({ id: conversationParticipants.conversationId })
      .from(conversationParticipants)
      .innerJoin(conversations, eq(conversations.id, conversationParticipants.conversationId))
      .where(and(
        eq(conversationParticipants.workspaceId, args.workspaceId),
        eq(conversationParticipants.principalId, actor.id),
        eq(conversationParticipants.status, 'active'),
        isNotNull(conversationParticipants.archivedAt),
        isNull(conversations.deletedAt),
      ))
    const ids = archived.map((row) => row.id)
    if (ids.length === 0) return []
    const rows = await this.db.select().from(conversations).where(and(
      inArray(conversations.id, ids),
      eq(conversations.workspaceId, args.workspaceId),
      isNull(conversations.deletedAt),
      isNull(conversations.projectId),
    )).orderBy(desc(conversations.lastModified))
    return rows.filter((row) => !row.isAutomation).map(mapAccessibleConversation)
  }

  async listMessages(args: {
    actorUserId: string
    beforeCreatedAt?: number
    conversationId: string
    limit: number
    mainOnly?: boolean
    messageId?: string
    threadRootMessageId?: string
    workspaceId: string
  }): Promise<ConversationMessageRow[]> {
    if (!await this.canAccessConversation(args)) throw new Error('CONVERSATION_ACCESS_DENIED')
    const before = args.beforeCreatedAt && Number.isFinite(args.beforeCreatedAt)
      ? new Date(args.beforeCreatedAt)
      : undefined
    const rows = await this.db.select().from(conversationMessages).where(and(
      eq(conversationMessages.conversationId, args.conversationId),
      before ? lt(conversationMessages.createdAt, before) : undefined,
      args.messageId ? eq(conversationMessages.id, args.messageId) : undefined,
      args.threadRootMessageId
        ? eq(conversationMessages.threadRootMessageId, args.threadRootMessageId)
        : undefined,
      args.mainOnly === true ? isNull(conversationMessages.threadRootMessageId) : undefined,
    )).orderBy(desc(conversationMessages.createdAt))
      .limit(Math.max(1, Math.min(100, Math.floor(args.limit))))
    return rows.reverse().map(mapCollaborationMessage)
  }

  async addMessage(args: {
    actorUserId: string
    clientNonce?: string
    content: string
    conversationId: string
    parts?: Array<Record<string, unknown>>
    replySnippet?: string
    replyToTurnId?: string
    threadRootMessageId?: string
    turnId: string
    workspaceId: string
  }): Promise<string> {
    const actor = await this.requireActor(args)
    if (!await this.canAccessConversation(args)) throw new Error('CONVERSATION_ACCESS_DENIED')
    const [conversation] = await this.db.select({ conversationType: conversations.conversationType })
      .from(conversations)
      .where(and(
        eq(conversations.id, args.conversationId),
        eq(conversations.workspaceId, args.workspaceId),
        isNull(conversations.deletedAt),
      )).limit(1)
    if (!conversation || conversation.conversationType === 'personal') {
      throw new Error('COLLABORATION_CONVERSATION_REQUIRED')
    }
    if (args.threadRootMessageId) {
      await this.requireConversationMessage({
        conversationId: args.conversationId,
        messageId: args.threadRootMessageId,
      })
    }
    if (args.clientNonce) {
      const [existing] = await this.db.select({ id: conversationMessages.id })
        .from(conversationMessages)
        .where(and(
          eq(conversationMessages.conversationId, args.conversationId),
          eq(conversationMessages.clientNonce, args.clientNonce),
        )).limit(1)
      if (existing) return existing.id
    }
    const id = `message_${randomUUID()}`
    const now = new Date()
    await this.db.transaction(async (tx) => {
      await tx.insert(conversationMessages).values({
        id,
        conversationId: args.conversationId,
        userId: args.actorUserId,
        turnId: args.turnId,
        role: 'user',
        mode: 'act',
        content: args.content,
        contentType: 'text',
        parts: args.parts,
        replyToTurnId: args.replyToTurnId,
        replySnippet: args.replySnippet,
        status: 'completed',
        authorKind: 'human',
        authorPrincipalId: actor.id,
        clientNonce: args.clientNonce,
        threadRootMessageId: args.threadRootMessageId,
        createdAt: now,
        updatedAt: now,
      })
      await tx.update(conversations).set({ lastModified: now, updatedAt: now })
        .where(eq(conversations.id, args.conversationId))
      await emitConversationEvent(tx, {
        conversationId: args.conversationId,
        messageId: id,
        type: 'message.created',
        userId: args.actorUserId,
      })
    })
    return id
  }

  async addAgentMessage(args: {
    actorUserId: string
    authorPrincipalId: string
    clientNonce: string
    content: string
    conversationId: string
    modelId: string
    threadRootMessageId?: string
    tokens?: { input: number; output: number }
    turnId: string
    workspaceId: string
  }): Promise<string> {
    if (!await this.canAccessConversation(args)) throw new Error('CONVERSATION_ACCESS_DENIED')
    const [agent] = await this.db.select({ principalId: workspacePrincipals.id })
      .from(conversationParticipants)
      .innerJoin(
        workspacePrincipals,
        eq(workspacePrincipals.id, conversationParticipants.principalId),
      )
      .where(and(
        eq(conversationParticipants.conversationId, args.conversationId),
        eq(conversationParticipants.principalId, args.authorPrincipalId),
        eq(conversationParticipants.status, 'active'),
        eq(workspacePrincipals.workspaceId, args.workspaceId),
        eq(workspacePrincipals.type, 'agent'),
        isNull(workspacePrincipals.archivedAt),
      ))
      .limit(1)
    if (!agent) throw new Error('AGENT_PARTICIPANT_REQUIRED')

    const [existing] = await this.db.select({ id: conversationMessages.id })
      .from(conversationMessages)
      .where(and(
        eq(conversationMessages.conversationId, args.conversationId),
        eq(conversationMessages.clientNonce, args.clientNonce),
      ))
      .limit(1)
    if (existing) return existing.id

    const id = `message_${randomUUID()}`
    const now = new Date()
    await this.db.transaction(async (tx) => {
      await tx.insert(conversationMessages).values({
        id,
        conversationId: args.conversationId,
        userId: args.actorUserId,
        turnId: args.turnId,
        role: 'assistant',
        mode: 'act',
        content: args.content,
        contentType: 'text',
        modelId: args.modelId,
        tokens: args.tokens,
        status: 'completed',
        authorKind: 'agent',
        authorPrincipalId: args.authorPrincipalId,
        clientNonce: args.clientNonce,
        threadRootMessageId: args.threadRootMessageId,
        createdAt: now,
        updatedAt: now,
      })
      await tx.update(conversations).set({ lastMode: 'act', lastModified: now, updatedAt: now })
        .where(eq(conversations.id, args.conversationId))
      await emitConversationEvent(tx, {
        conversationId: args.conversationId,
        messageId: id,
        type: 'message.created',
        userId: args.actorUserId,
      })
    })
    return id
  }

  async getConversationEventCursor(args: { actorUserId: string; workspaceId: string }): Promise<number> {
    const ids = await this.listAccessibleConversationIds(args)
    if (ids.length === 0) return 0
    const [row] = await this.db.select({ sequence: conversationEvents.sequence })
      .from(conversationEvents)
      .where(inArray(conversationEvents.conversationId, ids))
      .orderBy(desc(conversationEvents.sequence))
      .limit(1)
    return row?.sequence ?? 0
  }

  async listConversationEvents(args: {
    actorUserId: string
    afterSequence: number
    limit: number
    workspaceId: string
  }): Promise<ConversationEventRow[]> {
    const ids = await this.listAccessibleConversationIds(args)
    if (ids.length === 0) return []
    const rows = await this.db.select().from(conversationEvents).where(and(
      inArray(conversationEvents.conversationId, ids),
      gt(conversationEvents.sequence, args.afterSequence),
    )).orderBy(conversationEvents.sequence)
      .limit(Math.max(1, Math.min(200, Math.floor(args.limit))))
    return rows.map((row) => ({
      sequence: row.sequence,
      conversationId: row.conversationId,
      type: row.type as ConversationEventRow['type'],
      messageId: row.messageId ?? undefined,
      payload: row.payload ?? undefined,
      createdAt: row.createdAt.getTime(),
    }))
  }

  async createChannel(args: {
    actorUserId: string
    name: string
    principalIds?: string[]
    topic?: string
    visibility: 'public' | 'private'
    workspaceId: string
  }): Promise<ChannelSummary> {
    const actor = await this.requireActor(args)
    const name = cleanTitle(args.name)
    const slug = channelSlug(name)
    if (!name || !slug) throw new Error('Channel name is required')
    const [workspace] = await this.db.select({ kind: workspaces.kind }).from(workspaces).where(and(
      eq(workspaces.id, args.workspaceId),
      eq(workspaces.status, 'active'),
    )).limit(1)
    if (workspace?.kind !== 'organization') throw new Error('Channels require an organization workspace')

    const requestedIds = new Set([actor.id, ...(args.principalIds ?? [])])
    const eligible = await this.db
      .select({ principal: workspacePrincipals, membership: workspaceMemberships })
      .from(workspacePrincipals)
      .innerJoin(workspaceMemberships, and(
        eq(workspaceMemberships.workspaceId, workspacePrincipals.workspaceId),
        eq(workspaceMemberships.principalId, workspacePrincipals.id),
        eq(workspaceMemberships.status, 'active'),
      ))
      .where(and(
        eq(workspacePrincipals.workspaceId, args.workspaceId),
        inArray(workspacePrincipals.type, ['human', 'agent']),
        isNull(workspacePrincipals.archivedAt),
        args.visibility === 'private'
          ? inArray(workspacePrincipals.id, [...requestedIds])
          : undefined,
      ))
    if (!eligible.some(({ principal }) => principal.id === actor.id)) {
      throw new Error('WORKSPACE_ACCESS_DENIED')
    }
    if (args.visibility === 'private' && eligible.length !== requestedIds.size) {
      throw new Error('Every participant must be active in this workspace')
    }

    const conversationId = `conversation_${randomUUID()}`
    const now = new Date()
    await this.db.transaction(async (tx) => {
      await tx.insert(conversations).values({
        id: conversationId,
        workspaceId: args.workspaceId,
        conversationType: 'channel',
        createdByPrincipalId: actor.id,
        userId: args.actorUserId,
        title: name,
        lastMode: 'act',
        askModelIds: [DEFAULT_MODEL_ID],
        actModelId: DEFAULT_MODEL_ID,
        channelSlug: slug,
        channelVisibility: args.visibility,
        channelTopic: cleanTopic(args.topic),
        lastModified: now,
        createdAt: now,
        updatedAt: now,
      })
      await tx.insert(conversationParticipants).values(eligible.map(({ principal, membership }) => ({
        conversationId,
        workspaceId: args.workspaceId,
        principalId: principal.id,
        principalType: principal.type as 'human' | 'agent',
        role: principal.id === actor.id || membership.role === 'owner' || membership.role === 'admin'
          ? 'moderator' as const
          : 'member' as const,
        status: 'active' as const,
        notificationLevel: 'all' as const,
        joinedAt: now,
        updatedAt: now,
        lastReadAt: principal.id === actor.id ? now : undefined,
      })))
      await tx.insert(workspaceResourceScopes).values({
        workspaceId: args.workspaceId,
        resourceType: 'conversation',
        resourceId: conversationId,
        createdAt: now,
        updatedAt: now,
      })
      await tx.insert(conversationEvents).values({
        userId: args.actorUserId,
        conversationId,
        type: 'conversation.created',
        payload: { conversationType: 'channel', slug, visibility: args.visibility },
        createdAt: now,
      })
    })
    return {
      conversationId,
      workspaceId: args.workspaceId,
      name,
      slug,
      topic: cleanTopic(args.topic),
      visibility: args.visibility,
      participantCount: eligible.length,
      createdAt: now.getTime(),
      updatedAt: now.getTime(),
    }
  }

  async listChannels(args: {
    actorUserId: string
    workspaceId: string
  }): Promise<ChannelSummary[]> {
    const actor = await this.requireActor(args)
    const rows = await this.db
      .select({ conversation: conversations, participant: conversationParticipants })
      .from(conversationParticipants)
      .innerJoin(conversations, eq(conversations.id, conversationParticipants.conversationId))
      .where(and(
        eq(conversationParticipants.workspaceId, args.workspaceId),
        eq(conversationParticipants.principalId, actor.id),
        eq(conversationParticipants.status, 'active'),
        eq(conversations.conversationType, 'channel'),
        isNull(conversations.deletedAt),
      ))
      .orderBy(conversations.title)
    const counts = rows.length > 0
      ? await this.db.select({ conversationId: conversationParticipants.conversationId })
        .from(conversationParticipants)
        .where(and(
          inArray(conversationParticipants.conversationId, rows.map(({ conversation }) => conversation.id)),
          eq(conversationParticipants.status, 'active'),
        ))
      : []
    const countById = new Map<string, number>()
    for (const row of counts) countById.set(row.conversationId, (countById.get(row.conversationId) ?? 0) + 1)
    return rows.map(({ conversation }) => mapChannel(
      conversation,
      countById.get(conversation.id) ?? 0,
    ))
  }

  async createDirectMessage(args: {
    actorUserId: string
    principalIds: string[]
    sourceConversationId?: string
    title?: string
    workspaceId: string
  }): Promise<DirectMessageSummary> {
    const actor = await this.requireActor(args)
    const principalIds = [...new Set([actor.id, ...args.principalIds.map((id) => id.trim()).filter(Boolean)])]
      .sort()
    if (principalIds.length < 2) throw new Error('A direct message requires at least two participants')

    const eligible = await this.db
      .select({ principal: workspacePrincipals })
      .from(workspacePrincipals)
      .innerJoin(workspaceMemberships, and(
        eq(workspaceMemberships.workspaceId, workspacePrincipals.workspaceId),
        eq(workspaceMemberships.principalId, workspacePrincipals.id),
        eq(workspaceMemberships.status, 'active'),
      ))
      .where(and(
        eq(workspacePrincipals.workspaceId, args.workspaceId),
        inArray(workspacePrincipals.id, principalIds),
        inArray(workspacePrincipals.type, ['human', 'agent']),
        isNull(workspacePrincipals.archivedAt),
      ))
    if (eligible.length !== principalIds.length) {
      throw new Error('Every participant must be an active human or agent in this workspace')
    }

    const dmIdentityKey = createHash('sha256').update(principalIds.join('\0')).digest('hex')
    const [existing] = await this.db.select({ id: conversations.id, title: conversations.title })
      .from(conversations)
      .where(and(
        eq(conversations.workspaceId, args.workspaceId),
        eq(conversations.conversationType, 'dm'),
        eq(conversations.dmIdentityKey, dmIdentityKey),
        isNull(conversations.deletedAt),
      ))
      .limit(1)
    if (existing) {
      return {
        conversationId: existing.id,
        workspaceId: args.workspaceId,
        title: existing.title,
        participants: await this.listParticipants({
          actorUserId: args.actorUserId,
          conversationId: existing.id,
          workspaceId: args.workspaceId,
        }),
        created: false,
      }
    }

    const participantNames = eligible
      .map(({ principal }) => principal)
      .filter((principal) => principal.id !== actor.id)
      .map((principal) => principal.displayName)
    const title = cleanTitle(args.title) || participantNames.join(', ').slice(0, 120) || 'Direct message'
    const conversationId = `conversation_${randomUUID()}`
    const now = new Date()

    await this.db.transaction(async (tx) => {
      if (args.sourceConversationId) {
        const [source] = await tx.select().from(conversations).where(and(
          eq(conversations.id, args.sourceConversationId),
          eq(conversations.workspaceId, args.workspaceId),
          eq(conversations.userId, args.actorUserId),
          eq(conversations.conversationType, 'personal'),
          isNull(conversations.deletedAt),
        )).limit(1)
        if (!source) throw new Error('The source Personal chat is unavailable')
      }

      await tx.insert(conversations).values({
        id: conversationId,
        workspaceId: args.workspaceId,
        conversationType: 'dm',
        createdByPrincipalId: actor.id,
        userId: args.actorUserId,
        title,
        lastMode: 'act',
        askModelIds: [DEFAULT_MODEL_ID],
        actModelId: DEFAULT_MODEL_ID,
        dmIdentityKey,
        lastModified: now,
        createdAt: now,
        updatedAt: now,
      })
      await tx.insert(conversationParticipants).values(eligible.map(({ principal }) => ({
        conversationId,
        workspaceId: args.workspaceId,
        principalId: principal.id,
        principalType: principal.type as 'human' | 'agent',
        role: principal.id === actor.id ? 'moderator' as const : 'member' as const,
        status: 'active' as const,
        notificationLevel: 'all' as const,
        joinedAt: now,
        updatedAt: now,
        lastReadAt: principal.id === actor.id ? now : undefined,
      })))
      await tx.insert(workspaceResourceScopes).values({
        workspaceId: args.workspaceId,
        resourceType: 'conversation',
        resourceId: conversationId,
        createdAt: now,
        updatedAt: now,
      })
      await tx.insert(conversationEvents).values({
        userId: args.actorUserId,
        conversationId,
        type: 'conversation.created',
        createdAt: now,
      })

      const invitees = eligible.map(({ principal }) => principal).filter((principal) => principal.id !== actor.id)
      if (invitees.length > 0) {
        await tx.insert(workspaceNotifications).values(invitees.map((principal) => ({
          id: `notification_${randomUUID()}`,
          workspaceId: args.workspaceId,
          recipientPrincipalId: principal.id,
          type: 'participant' as const,
          conversationId,
          actorPrincipalId: actor.id,
          title: `${actor.displayName} started a conversation`,
          body: title,
          createdAt: now,
        })))
      }
    })

    return {
      conversationId,
      workspaceId: args.workspaceId,
      title,
      participants: await this.listParticipants({
        actorUserId: args.actorUserId,
        conversationId,
        workspaceId: args.workspaceId,
      }),
      created: true,
    }
  }

  async listAccessibleConversationIds(args: {
    actorUserId: string
    workspaceId: string
  }): Promise<string[]> {
    const actor = await this.requireActor(args)
    const owned = await this.db.select({ id: conversations.id }).from(conversations).where(and(
      eq(conversations.workspaceId, args.workspaceId),
      eq(conversations.userId, args.actorUserId),
      eq(conversations.conversationType, 'personal'),
      isNull(conversations.deletedAt),
    ))
    const shared = await this.db
      .select({ id: conversationParticipants.conversationId })
      .from(conversationParticipants)
      .innerJoin(conversations, eq(conversations.id, conversationParticipants.conversationId))
      .where(and(
        eq(conversationParticipants.workspaceId, args.workspaceId),
        eq(conversationParticipants.principalId, actor.id),
        eq(conversationParticipants.status, 'active'),
        isNull(conversationParticipants.archivedAt),
        isNull(conversations.deletedAt),
      ))
    return [...new Set([...owned, ...shared].map((row) => row.id))]
  }

  async canAccessConversation(args: {
    actorUserId: string
    conversationId: string
    workspaceId: string
  }): Promise<boolean> {
    const actor = await this.requireActor(args)
    const [conversation] = await this.db.select().from(conversations).where(and(
      eq(conversations.id, args.conversationId),
      eq(conversations.workspaceId, args.workspaceId),
      isNull(conversations.deletedAt),
    )).limit(1)
    if (!conversation) return false
    if (conversation.conversationType === 'personal') return conversation.userId === args.actorUserId
    const [participant] = await this.db.select({ principalId: conversationParticipants.principalId })
      .from(conversationParticipants)
      .where(and(
        eq(conversationParticipants.conversationId, args.conversationId),
        eq(conversationParticipants.principalId, actor.id),
        eq(conversationParticipants.status, 'active'),
      )).limit(1)
    return Boolean(participant)
  }

  async listParticipants(args: {
    actorUserId: string
    conversationId: string
    workspaceId: string
  }): Promise<ConversationParticipant[]> {
    if (!await this.canAccessConversation(args)) throw new Error('CONVERSATION_ACCESS_DENIED')
    const rows = await this.db
      .select({ participant: conversationParticipants, principal: workspacePrincipals })
      .from(conversationParticipants)
      .innerJoin(workspacePrincipals, eq(workspacePrincipals.id, conversationParticipants.principalId))
      .where(and(
        eq(conversationParticipants.conversationId, args.conversationId),
        eq(conversationParticipants.status, 'active'),
      ))
      .orderBy(conversationParticipants.joinedAt)
    return rows.map(({ participant, principal }) => mapParticipant(participant, principal))
  }

  async addParticipant(args: {
    actorUserId: string
    conversationId: string
    principalId: string
    workspaceId: string
  }): Promise<ConversationParticipant> {
    const actor = await this.requireModerator(args)
    const [conversation] = await this.db.select({ conversationType: conversations.conversationType })
      .from(conversations)
      .where(and(
        eq(conversations.id, args.conversationId),
        eq(conversations.workspaceId, args.workspaceId),
        isNull(conversations.deletedAt),
      )).limit(1)
    if (conversation?.conversationType === 'dm') {
      throw new Error('DIRECT_MESSAGE_REQUIRES_NEW_GROUP')
    }
    const [principal] = await this.db.select().from(workspacePrincipals)
      .innerJoin(workspaceMemberships, and(
        eq(workspaceMemberships.workspaceId, workspacePrincipals.workspaceId),
        eq(workspaceMemberships.principalId, workspacePrincipals.id),
      ))
      .where(and(
        eq(workspacePrincipals.workspaceId, args.workspaceId),
        eq(workspacePrincipals.id, args.principalId),
        inArray(workspacePrincipals.type, ['human', 'agent']),
        eq(workspaceMemberships.status, 'active'),
        isNull(workspacePrincipals.archivedAt),
      ))
      .limit(1)
    if (!principal) throw new Error('Participant is not eligible')
    const now = new Date()
    const [row] = await this.db.insert(conversationParticipants).values({
      conversationId: args.conversationId,
      workspaceId: args.workspaceId,
      principalId: args.principalId,
      principalType: principal.workspace_principals.type as 'human' | 'agent',
      role: 'member',
      status: 'active',
      notificationLevel: 'all',
      joinedAt: now,
      updatedAt: now,
    }).onConflictDoUpdate({
      target: [conversationParticipants.conversationId, conversationParticipants.principalId],
      set: { status: 'active', removedAt: null, archivedAt: null, updatedAt: now },
    }).returning()
    await this.db.insert(workspaceNotifications).values({
      id: `notification_${randomUUID()}`,
      workspaceId: args.workspaceId,
      recipientPrincipalId: args.principalId,
      type: 'participant',
      conversationId: args.conversationId,
      actorPrincipalId: actor.id,
      title: `${actor.displayName} added you to a conversation`,
      createdAt: now,
    })
    return mapParticipant(required(row), principal.workspace_principals)
  }

  async removeParticipant(args: {
    actorUserId: string
    conversationId: string
    principalId: string
    workspaceId: string
  }): Promise<boolean> {
    const actor = await this.requireActor(args)
    if (actor.id !== args.principalId) await this.requireModerator(args)
    const active = await this.db.select({ id: conversationParticipants.principalId })
      .from(conversationParticipants)
      .where(and(
        eq(conversationParticipants.conversationId, args.conversationId),
        eq(conversationParticipants.status, 'active'),
      ))
    if (active.length <= 1) throw new Error('A conversation must retain one participant')
    const now = new Date()
    const rows = await this.db.update(conversationParticipants).set({
      status: 'removed',
      removedAt: now,
      archivedAt: now,
      updatedAt: now,
    }).where(and(
      eq(conversationParticipants.conversationId, args.conversationId),
      eq(conversationParticipants.principalId, args.principalId),
      eq(conversationParticipants.status, 'active'),
    )).returning({ id: conversationParticipants.principalId })
    return rows.length > 0
  }

  async updateParticipantState(args: {
    actorUserId: string
    archived?: boolean
    conversationId: string
    markRead?: boolean
    markUnread?: boolean
    notificationLevel?: 'all' | 'mentions' | 'muted'
    readSequence?: number
    workspaceId: string
  }): Promise<ConversationParticipant> {
    const actor = await this.requireActor(args)
    if (!await this.canAccessConversation(args)) throw new Error('CONVERSATION_ACCESS_DENIED')
    const now = new Date()
    const requestedReadSequence = Number.isSafeInteger(args.readSequence) && (args.readSequence ?? 0) >= 0
      ? args.readSequence
      : undefined
    let readSequence = requestedReadSequence
    if (args.markRead || requestedReadSequence !== undefined) {
      const [event] = await this.db.select({ sequence: conversationEvents.sequence })
        .from(conversationEvents)
        .where(eq(conversationEvents.conversationId, args.conversationId))
        .orderBy(desc(conversationEvents.sequence))
        .limit(1)
      readSequence = Math.min(requestedReadSequence ?? Number.MAX_SAFE_INTEGER, event?.sequence ?? 0)
    }
    const patch = {
      ...(args.notificationLevel ? { notificationLevel: args.notificationLevel } : {}),
      ...(args.archived !== undefined ? { archivedAt: args.archived ? now : null } : {}),
      ...(args.markRead ? { lastReadAt: now, lastReadSequence: readSequence ?? 0, markedUnreadAt: null } : {}),
      ...(readSequence !== undefined && !args.markRead ? { lastReadSequence: readSequence } : {}),
      ...(args.markUnread ? { markedUnreadAt: now } : {}),
      updatedAt: now,
    }
    let [row] = await this.db.update(conversationParticipants).set(patch).where(and(
      eq(conversationParticipants.conversationId, args.conversationId),
      eq(conversationParticipants.principalId, actor.id),
      eq(conversationParticipants.status, 'active'),
    )).returning()
    if (!row) {
      const [conversation] = await this.db.select({
        conversationType: conversations.conversationType,
        userId: conversations.userId,
      }).from(conversations).where(and(
        eq(conversations.id, args.conversationId),
        eq(conversations.workspaceId, args.workspaceId),
        isNull(conversations.deletedAt),
      )).limit(1)
      if (!conversation || conversation.conversationType !== 'personal' || conversation.userId !== args.actorUserId) {
        throw new Error('CONVERSATION_ACCESS_DENIED')
      }
      await this.db.insert(conversationParticipants).values({
        conversationId: args.conversationId,
        workspaceId: args.workspaceId,
        principalId: actor.id,
        principalType: actor.type === 'agent' ? 'agent' : 'human',
        role: 'moderator',
        status: 'active',
        notificationLevel: 'all',
        joinedAt: now,
        updatedAt: now,
      }).onConflictDoUpdate({
        target: [conversationParticipants.conversationId, conversationParticipants.principalId],
        set: { status: 'active', removedAt: null, updatedAt: now },
      })
      ;[row] = await this.db.update(conversationParticipants).set(patch).where(and(
        eq(conversationParticipants.conversationId, args.conversationId),
        eq(conversationParticipants.principalId, actor.id),
        eq(conversationParticipants.status, 'active'),
      )).returning()
    }
    if (!row) throw new Error('CONVERSATION_ACCESS_DENIED')
    return mapParticipant(row, actor)
  }

  async upsertPresence(args: {
    actorUserId: string
    conversationId?: string
    sessionId?: string
    status: 'online' | 'away' | 'offline'
    typing?: boolean
    workspaceId: string
  }): Promise<ConversationPresence> {
    const actor = await this.requireActor(args)
    if (args.conversationId && !await this.canAccessConversation({
      ...args,
      conversationId: args.conversationId,
    })) throw new Error('CONVERSATION_ACCESS_DENIED')
    const now = new Date()
    const sessionId = args.sessionId?.trim() || 'legacy'
    const typingExpiresAt = args.typing && args.conversationId
      ? new Date(now.getTime() + 6_000)
      : null
    const [row] = await this.db.insert(workspacePresence).values({
      workspaceId: args.workspaceId,
      principalId: actor.id,
      sessionId,
      conversationId: args.conversationId,
      status: args.status,
      lastSeenAt: now,
      typingExpiresAt,
      updatedAt: now,
    }).onConflictDoUpdate({
      target: [workspacePresence.workspaceId, workspacePresence.principalId, workspacePresence.sessionId],
      set: {
        conversationId: args.conversationId ?? null,
        status: args.status,
        lastSeenAt: now,
        typingExpiresAt,
        updatedAt: now,
      },
    }).returning()
    return mapPresence(required(row), now)
  }

  async listPresence(args: {
    actorUserId: string
    conversationId: string
    workspaceId: string
  }): Promise<ConversationPresence[]> {
    if (!await this.canAccessConversation(args)) throw new Error('CONVERSATION_ACCESS_DENIED')
    const rows = await this.db.select().from(workspacePresence)
      .innerJoin(conversationParticipants, and(
        eq(conversationParticipants.workspaceId, workspacePresence.workspaceId),
        eq(conversationParticipants.principalId, workspacePresence.principalId),
        eq(conversationParticipants.conversationId, args.conversationId),
        eq(conversationParticipants.status, 'active'),
      ))
      .where(and(
        eq(workspacePresence.workspaceId, args.workspaceId),
        or(
          isNull(workspacePresence.conversationId),
          eq(workspacePresence.conversationId, args.conversationId),
        ),
      ))
    const now = new Date()
    const sessionsByPrincipal = new Map<string, Array<typeof rows[number]['workspace_presence']>>()
    for (const row of rows) {
      const sessions = sessionsByPrincipal.get(row.workspace_presence.principalId) ?? []
      sessions.push(row.workspace_presence)
      sessionsByPrincipal.set(row.workspace_presence.principalId, sessions)
    }
    return [...sessionsByPrincipal.values()].map((sessions) => {
      const active = sessions
        .filter((session) => now.getTime() - session.lastSeenAt.getTime() <= 120_000)
        .filter((session) => session.status !== 'offline')
        .sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime())
      const latest = [...sessions].sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime())[0]!
      const representative = active[0] ?? latest
      const status = active.some((session) => session.status === 'online')
        ? 'online'
        : active.length > 0 ? 'away' : 'offline'
      const typing = active.some((session) => Boolean(
        session.typingExpiresAt && session.typingExpiresAt.getTime() > now.getTime(),
      ))
      return mapPresence({ ...representative, status }, now, { typing })
    })
  }

  async recordMessageActivity(args: {
    actorUserId: string
    body?: string
    conversationId: string
    mentionedPrincipalIds?: string[]
    messageId: string
    threadRootMessageId?: string
    workspaceId: string
  }): Promise<void> {
    const actor = await this.requireActor(args)
    if (!await this.canAccessConversation(args)) throw new Error('CONVERSATION_ACCESS_DENIED')
    const now = new Date()
    const [conversation] = await this.db.select({ conversationType: conversations.conversationType }).from(conversations).where(
      and(eq(conversations.id, args.conversationId), eq(conversations.workspaceId, args.workspaceId)),
    ).limit(1)
    const participants = await this.db.select().from(conversationParticipants).where(and(
      eq(conversationParticipants.conversationId, args.conversationId),
      eq(conversationParticipants.status, 'active'),
    ))
    const mentions = new Set(args.mentionedPrincipalIds ?? [])
    const hasChannelMention = conversation?.conversationType === 'channel' && /(^|\s)@channel(?=\s|$)/i.test(args.body ?? '')
    const hasHereMention = conversation?.conversationType === 'channel' && /(^|\s)@here(?=\s|$)/i.test(args.body ?? '')
    const presenceRows = hasHereMention
      ? await this.db.select({ principalId: workspacePresence.principalId, lastSeenAt: workspacePresence.lastSeenAt, status: workspacePresence.status })
        .from(workspacePresence)
        .where(and(eq(workspacePresence.workspaceId, args.workspaceId), eq(workspacePresence.status, 'online')))
      : []
    const activeHere = new Set(presenceRows
      .filter((row) => now.getTime() - row.lastSeenAt.getTime() <= 120_000)
      .map((row) => row.principalId))
    const followers = args.threadRootMessageId
      ? await this.db.select({ principalId: conversationThreadFollows.principalId }).from(conversationThreadFollows).where(and(
        eq(conversationThreadFollows.workspaceId, args.workspaceId),
        eq(conversationThreadFollows.threadRootMessageId, args.threadRootMessageId),
      ))
      : []
    const followerIds = new Set(followers.map((row) => row.principalId))
    const preferences = await this.db.select().from(workspaceNotificationPreferences).where(
      eq(workspaceNotificationPreferences.workspaceId, args.workspaceId),
    )
    const preferenceByPrincipal = new Map(preferences.map((row) => [row.principalId, row]))
    const [messageEvent] = await this.db.select({ sequence: conversationEvents.sequence }).from(conversationEvents).where(and(
      eq(conversationEvents.conversationId, args.conversationId),
      eq(conversationEvents.messageId, args.messageId),
      eq(conversationEvents.type, 'message.created'),
    )).orderBy(desc(conversationEvents.sequence)).limit(1)
    type NotificationRecipient = {
      participant: typeof participants[number]
      type: 'message' | 'mention' | 'thread'
      mentionScope?: 'direct' | 'channel' | 'here'
    }
    const recipients = participants.filter((participant) => participant.principalId !== actor.id).map((participant): NotificationRecipient | null => {
      const directMention = mentions.has(participant.principalId)
      const broadcastMention = hasChannelMention || (hasHereMention && activeHere.has(participant.principalId))
      const followedThread = Boolean(args.threadRootMessageId && followerIds.has(participant.principalId))
      const mentionScope = directMention ? 'direct' as const : hasChannelMention ? 'channel' as const : hasHereMention ? 'here' as const : undefined
      const preference = preferenceByPrincipal.get(participant.principalId)
      if (directMention || broadcastMention) {
        if (preference?.mentions === 'off') return null
        return { participant, type: 'mention' as const, mentionScope }
      }
      if (followedThread) {
        if (preference?.threadReplies === 'off' || participant.notificationLevel === 'muted') return null
        return { participant, type: 'thread' as const, mentionScope: undefined }
      }
      if (participant.notificationLevel === 'muted') return null
      if (participant.notificationLevel === 'mentions') return null
      const mode = conversation?.conversationType === 'dm'
        ? preference?.dmMessages
        : preference?.channelMessages
      if (mode === 'off') return null
      return { participant, type: 'message' as const, mentionScope: undefined }
    }).filter((value): value is NotificationRecipient => value !== null)
    await this.db.transaction(async (tx) => {
      if (recipients.length > 0) {
        await tx.insert(workspaceNotifications).values(recipients.map((recipient) => ({
          id: `notification_${randomUUID()}`,
          workspaceId: args.workspaceId,
          recipientPrincipalId: recipient.participant.principalId,
          type: recipient.type,
          conversationId: args.conversationId,
          messageId: args.messageId,
          actorPrincipalId: actor.id,
          threadRootMessageId: args.threadRootMessageId,
          eventSequence: messageEvent?.sequence,
          mentionScope: recipient.mentionScope,
          title: recipient.type === 'mention'
            ? `${actor.displayName} mentioned you`
            : recipient.type === 'thread'
              ? `${actor.displayName} replied in a thread`
              : `New message from ${actor.displayName}`,
          body: args.body?.slice(0, 240),
          createdAt: now,
        })))
      }
    })
  }

  async editMessage(args: {
    actorUserId: string
    content: string
    conversationId: string
    messageId: string
    workspaceId: string
  }): Promise<boolean> {
    const actor = await this.requireActor(args)
    if (!await this.canAccessConversation(args)) throw new Error('CONVERSATION_ACCESS_DENIED')
    const content = args.content.trim()
    if (!content) throw new Error('Message content is required')
    const now = new Date()
    return await this.db.transaction(async (tx) => {
      const [message] = await tx.select({
        content: conversationMessages.content,
        editHistory: conversationMessages.editHistory,
      }).from(conversationMessages).where(and(
        eq(conversationMessages.id, args.messageId),
        eq(conversationMessages.conversationId, args.conversationId),
        eq(conversationMessages.authorKind, 'human'),
        eq(conversationMessages.authorPrincipalId, actor.id),
        isNull(conversationMessages.deletedAt),
      )).limit(1).for('update')
      if (!message) return false
      const rows = await tx.update(conversationMessages).set({
        content,
        editedAt: now,
        editHistory: [
          ...(message.editHistory ?? []),
          { content: message.content, editedAt: now.getTime() },
        ],
        updatedAt: now,
      }).where(eq(conversationMessages.id, args.messageId)).returning({ id: conversationMessages.id })
      if (rows.length > 0) {
        await emitConversationEvent(tx, {
          conversationId: args.conversationId,
          messageId: args.messageId,
          payload: { editedAt: now.getTime() },
          type: 'message.ui-updated',
          userId: actor.userId ?? args.actorUserId,
        })
      }
      return rows.length > 0
    })
  }

  async deleteMessage(args: {
    actorUserId: string
    conversationId: string
    messageId: string
    workspaceId: string
  }): Promise<boolean> {
    const actor = await this.requireActor(args)
    if (!await this.canAccessConversation(args)) throw new Error('CONVERSATION_ACCESS_DENIED')
    const now = new Date()
    const rows = await this.db.update(conversationMessages).set({
      content: '',
      parts: [],
      deletedAt: now,
      updatedAt: now,
    }).where(and(
      eq(conversationMessages.id, args.messageId),
      eq(conversationMessages.conversationId, args.conversationId),
      eq(conversationMessages.authorKind, 'human'),
      eq(conversationMessages.authorPrincipalId, actor.id),
      isNull(conversationMessages.deletedAt),
    )).returning({ id: conversationMessages.id })
    return rows.length > 0
  }

  async listReactions(args: {
    actorUserId: string
    conversationId: string
    workspaceId: string
  }): Promise<MessageReaction[]> {
    const actor = await this.requireActor(args)
    if (!await this.canAccessConversation(args)) throw new Error('CONVERSATION_ACCESS_DENIED')
    const rows = await this.db.select().from(conversationMessageReactions).where(and(
      eq(conversationMessageReactions.conversationId, args.conversationId),
      eq(conversationMessageReactions.workspaceId, args.workspaceId),
    )).orderBy(conversationMessageReactions.createdAt)
    return groupReactions(rows, actor.id)
  }

  async setReaction(args: {
    actorUserId: string
    conversationId: string
    emoji: string
    enabled: boolean
    messageId: string
    workspaceId: string
  }): Promise<MessageReaction[]> {
    const actor = await this.requireActor(args)
    if (!await this.canAccessConversation(args)) throw new Error('CONVERSATION_ACCESS_DENIED')
    const emoji = args.emoji.trim()
    if (!emoji || emoji.length > 32) throw new Error('A valid reaction is required')
    await this.requireConversationMessage(args)
    let reactionChanged = false
    if (args.enabled) {
      const inserted = await this.db.insert(conversationMessageReactions).values({
        conversationId: args.conversationId,
        messageId: args.messageId,
        workspaceId: args.workspaceId,
        principalId: actor.id,
        emoji,
        createdAt: new Date(),
      }).onConflictDoNothing().returning({ messageId: conversationMessageReactions.messageId })
      reactionChanged = inserted.length > 0
    } else {
      const deleted = await this.db.delete(conversationMessageReactions).where(and(
        eq(conversationMessageReactions.messageId, args.messageId),
        eq(conversationMessageReactions.principalId, actor.id),
        eq(conversationMessageReactions.emoji, emoji),
      )).returning({ messageId: conversationMessageReactions.messageId })
      reactionChanged = deleted.length > 0
    }
    const [message] = await this.db.select({ authorPrincipalId: conversationMessages.authorPrincipalId }).from(conversationMessages).where(
      and(eq(conversationMessages.id, args.messageId), eq(conversationMessages.conversationId, args.conversationId)),
    ).limit(1)
    if (message?.authorPrincipalId && message.authorPrincipalId !== actor.id && args.enabled && reactionChanged) {
      const [preference] = await this.db.select({ mode: workspaceNotificationPreferences.reactions }).from(workspaceNotificationPreferences).where(and(
        eq(workspaceNotificationPreferences.workspaceId, args.workspaceId),
        eq(workspaceNotificationPreferences.principalId, message.authorPrincipalId),
      )).limit(1)
      if (preference?.mode !== 'off') {
        await this.db.insert(workspaceNotifications).values({
          id: `notification_${randomUUID()}`,
          workspaceId: args.workspaceId,
          recipientPrincipalId: message.authorPrincipalId,
          type: 'reaction',
          conversationId: args.conversationId,
          messageId: args.messageId,
          actorPrincipalId: actor.id,
          title: `${actor.displayName} reacted ${emoji}`,
          body: undefined,
          createdAt: new Date(),
        })
      }
    }
    if (reactionChanged) {
      await emitConversationEvent(this.db, {
        conversationId: args.conversationId,
        messageId: args.messageId,
        payload: { enabled: args.enabled, emoji },
        type: 'reaction.changed',
        userId: actor.userId ?? args.actorUserId,
      })
    }
    return await this.listReactions(args)
  }

  async listPins(args: {
    actorUserId: string
    conversationId: string
    workspaceId: string
  }): Promise<ConversationPin[]> {
    if (!await this.canAccessConversation(args)) throw new Error('CONVERSATION_ACCESS_DENIED')
    const rows = await this.db.select().from(conversationPins).where(and(
      eq(conversationPins.conversationId, args.conversationId),
      eq(conversationPins.workspaceId, args.workspaceId),
    )).orderBy(desc(conversationPins.createdAt))
    return rows.map((row) => ({
      conversationId: row.conversationId,
      messageId: row.messageId,
      pinnedByPrincipalId: row.pinnedByPrincipalId,
      createdAt: row.createdAt.getTime(),
    }))
  }

  async setPinned(args: {
    actorUserId: string
    conversationId: string
    messageId: string
    pinned: boolean
    workspaceId: string
  }): Promise<boolean> {
    const actor = await this.requireActor(args)
    if (!await this.canAccessConversation(args)) throw new Error('CONVERSATION_ACCESS_DENIED')
    await this.requireConversationMessage(args)
    if (args.pinned) {
      const rows = await this.db.insert(conversationPins).values({
        conversationId: args.conversationId,
        messageId: args.messageId,
        workspaceId: args.workspaceId,
        pinnedByPrincipalId: actor.id,
        createdAt: new Date(),
      }).onConflictDoNothing().returning({ messageId: conversationPins.messageId })
      if (rows.length > 0) {
        await emitConversationEvent(this.db, {
          conversationId: args.conversationId,
          messageId: args.messageId,
          payload: { pinned: true },
          type: 'pin.changed',
          userId: actor.userId ?? args.actorUserId,
        })
      }
      return rows.length > 0
    }
    const rows = await this.db.delete(conversationPins).where(and(
      eq(conversationPins.conversationId, args.conversationId),
      eq(conversationPins.messageId, args.messageId),
    )).returning({ messageId: conversationPins.messageId })
    if (rows.length > 0) {
      await emitConversationEvent(this.db, {
        conversationId: args.conversationId,
        messageId: args.messageId,
        payload: { pinned: false },
        type: 'pin.changed',
        userId: actor.userId ?? args.actorUserId,
      })
    }
    return rows.length > 0
  }

  async listSavedMessages(args: {
    actorUserId: string
    workspaceId: string
  }): Promise<ConversationSavedMessage[]> {
    const actor = await this.requireActor(args)
    const rows = await this.db.select().from(conversationSavedMessages).where(and(
      eq(conversationSavedMessages.workspaceId, args.workspaceId),
      eq(conversationSavedMessages.principalId, actor.id),
    )).orderBy(desc(conversationSavedMessages.createdAt))
    return rows.map((row) => ({
      conversationId: row.conversationId,
      messageId: row.messageId,
      principalId: row.principalId,
      createdAt: row.createdAt.getTime(),
    }))
  }

  async setSaved(args: {
    actorUserId: string
    conversationId: string
    messageId: string
    saved: boolean
    workspaceId: string
  }): Promise<boolean> {
    const actor = await this.requireActor(args)
    if (!await this.canAccessConversation(args)) throw new Error('CONVERSATION_ACCESS_DENIED')
    await this.requireConversationMessage(args)
    if (args.saved) {
      const rows = await this.db.insert(conversationSavedMessages).values({
        conversationId: args.conversationId,
        messageId: args.messageId,
        workspaceId: args.workspaceId,
        principalId: actor.id,
        createdAt: new Date(),
      }).onConflictDoNothing().returning({ messageId: conversationSavedMessages.messageId })
      return rows.length > 0
    }
    const rows = await this.db.delete(conversationSavedMessages).where(and(
      eq(conversationSavedMessages.messageId, args.messageId),
      eq(conversationSavedMessages.principalId, actor.id),
    )).returning({ messageId: conversationSavedMessages.messageId })
    return rows.length > 0
  }

  async searchWorkspaceChats(args: {
    actorUserId: string
    limit?: number
    query: string
    workspaceId: string
  }): Promise<WorkspaceChatSearchResult[]> {
    const query = args.query.trim()
    if (!query) return []
    const accessibleIds = await this.listAccessibleConversationIds(args)
    if (accessibleIds.length === 0) return []
    const limit = Math.max(1, Math.min(100, args.limit ?? 30))
    const [conversationRows, messageRows] = await Promise.all([
      this.db.select().from(conversations).where(and(
        inArray(conversations.id, accessibleIds),
        ilike(conversations.title, `%${query}%`),
        isNull(conversations.deletedAt),
      )).orderBy(desc(conversations.lastModified)).limit(limit),
      this.db.select({ message: conversationMessages, conversation: conversations })
        .from(conversationMessages)
        .innerJoin(conversations, eq(conversations.id, conversationMessages.conversationId))
        .where(and(
          inArray(conversationMessages.conversationId, accessibleIds),
          or(
            ilike(conversationMessages.content, `%${query}%`),
            ilike(conversations.title, `%${query}%`),
          ),
          isNull(conversationMessages.deletedAt),
          isNull(conversations.deletedAt),
        )).orderBy(desc(conversationMessages.createdAt)).limit(limit),
    ])
    const results: WorkspaceChatSearchResult[] = [
      ...conversationRows.map((conversation) => ({
        conversationId: conversation.id,
        conversationType: conversation.conversationType,
        title: conversation.title,
        createdAt: conversation.createdAt.getTime(),
      })),
      ...messageRows.map(({ message, conversation }) => ({
        conversationId: conversation.id,
        conversationType: conversation.conversationType,
        title: conversation.title,
        messageId: message.id,
        snippet: message.content.slice(0, 240),
        createdAt: message.createdAt.getTime(),
      })),
    ]
    return results
      .sort((left, right) => right.createdAt - left.createdAt)
      .slice(0, limit)
  }

  async listNotifications(args: {
    actorUserId: string
    filter?: WorkspaceNotificationFilter
    limit?: number
    unreadOnly?: boolean
    workspaceId: string
  }): Promise<WorkspaceNotification[]> {
    const actor = await this.requireActor(args)
    const rows = await this.db.select().from(workspaceNotifications).where(and(
      eq(workspaceNotifications.workspaceId, args.workspaceId),
      eq(workspaceNotifications.recipientPrincipalId, actor.id),
      args.unreadOnly || args.filter === 'unread' ? isNull(workspaceNotifications.readAt) : undefined,
      args.filter === 'mentions' ? eq(workspaceNotifications.type, 'mention') : undefined,
      args.filter === 'threads' ? eq(workspaceNotifications.type, 'thread') : undefined,
      args.filter === 'reactions' ? eq(workspaceNotifications.type, 'reaction') : undefined,
    )).orderBy(desc(workspaceNotifications.createdAt))
      .limit(Math.max(1, Math.min(100, args.limit ?? 50)))
    const notifications = rows.map(mapNotification)
    const conversationIds = [...new Set(
      notifications
        .map((notification) => notification.conversationId)
        .filter((id): id is string => Boolean(id)),
    )]
    if (conversationIds.length === 0) return notifications

    const [conversationRows, participantRows] = await Promise.all([
      this.db.select({
        id: conversations.id,
        deletedAt: conversations.deletedAt,
      }).from(conversations).where(inArray(conversations.id, conversationIds)),
      this.db.select({
        conversationId: conversationParticipants.conversationId,
        archivedAt: conversationParticipants.archivedAt,
      }).from(conversationParticipants).where(and(
        inArray(conversationParticipants.conversationId, conversationIds),
        eq(conversationParticipants.principalId, actor.id),
      )),
    ])
    const conversationById = new Map(conversationRows.map((row) => [row.id, row]))
    const archivedAtById = new Map(participantRows.map((row) => [row.conversationId, row.archivedAt]))
    return notifications.map((notification) => {
      if (!notification.conversationId) return notification
      const conversationState = resolveConversationActivityState({
        archivedAt: archivedAtById.get(notification.conversationId)?.getTime(),
        conversation: conversationById.has(notification.conversationId)
          ? { deletedAt: conversationById.get(notification.conversationId)?.deletedAt?.getTime() }
          : null,
      })
      return conversationState ? { ...notification, conversationState } : notification
    })
  }

  async markNotificationsRead(args: {
    actorUserId: string
    conversationId?: string
    notificationIds?: string[]
    workspaceId: string
  }): Promise<number> {
    const actor = await this.requireActor(args)
    const rows = await this.db.update(workspaceNotifications).set({ readAt: new Date() }).where(and(
      eq(workspaceNotifications.workspaceId, args.workspaceId),
      eq(workspaceNotifications.recipientPrincipalId, actor.id),
      isNull(workspaceNotifications.readAt),
      args.conversationId
        ? eq(workspaceNotifications.conversationId, args.conversationId)
        : undefined,
      args.notificationIds?.length
        ? inArray(workspaceNotifications.id, args.notificationIds)
        : undefined,
    )).returning({ id: workspaceNotifications.id })
    return rows.length
  }

  async setThreadFollow(args: {
    actorUserId: string
    conversationId: string
    threadRootMessageId: string
    followed: boolean
    workspaceId: string
  }): Promise<boolean> {
    const actor = await this.requireActor(args)
    if (!await this.canAccessConversation(args)) throw new Error('CONVERSATION_ACCESS_DENIED')
    await this.requireConversationMessage({ conversationId: args.conversationId, messageId: args.threadRootMessageId })
    if (args.followed) {
      const rows = await this.db.insert(conversationThreadFollows).values({
        workspaceId: args.workspaceId,
        conversationId: args.conversationId,
        threadRootMessageId: args.threadRootMessageId,
        principalId: actor.id,
        followedAt: new Date(),
      }).onConflictDoNothing().returning({ threadRootMessageId: conversationThreadFollows.threadRootMessageId })
      return rows.length > 0
    }
    const rows = await this.db.delete(conversationThreadFollows).where(and(
      eq(conversationThreadFollows.workspaceId, args.workspaceId),
      eq(conversationThreadFollows.threadRootMessageId, args.threadRootMessageId),
      eq(conversationThreadFollows.principalId, actor.id),
    )).returning({ threadRootMessageId: conversationThreadFollows.threadRootMessageId })
    return rows.length > 0
  }

  async listThreadFollows(args: {
    actorUserId: string
    conversationId: string
    threadRootMessageId?: string
    workspaceId: string
  }): Promise<ConversationThreadFollow[]> {
    const actor = await this.requireActor(args)
    if (!await this.canAccessConversation(args)) throw new Error('CONVERSATION_ACCESS_DENIED')
    const rows = await this.db.select().from(conversationThreadFollows).where(and(
      eq(conversationThreadFollows.workspaceId, args.workspaceId),
      eq(conversationThreadFollows.conversationId, args.conversationId),
      args.threadRootMessageId ? eq(conversationThreadFollows.threadRootMessageId, args.threadRootMessageId) : undefined,
      args.threadRootMessageId ? undefined : eq(conversationThreadFollows.principalId, actor.id),
    )).orderBy(desc(conversationThreadFollows.followedAt))
    return rows.map((row) => ({
      conversationId: row.conversationId,
      threadRootMessageId: row.threadRootMessageId,
      principalId: row.principalId,
      followedAt: row.followedAt.getTime(),
    }))
  }

  async getNotificationPreferences(args: {
    actorUserId: string
    workspaceId: string
  }): Promise<WorkspaceNotificationPreferences> {
    const actor = await this.requireActor(args)
    const [row] = await this.db.select().from(workspaceNotificationPreferences).where(and(
      eq(workspaceNotificationPreferences.workspaceId, args.workspaceId),
      eq(workspaceNotificationPreferences.principalId, actor.id),
    )).limit(1)
    return mapNotificationPreferences(row)
  }

  async updateNotificationPreferences(args: {
    actorUserId: string
    workspaceId: string
    preferences: Partial<WorkspaceNotificationPreferences>
  }): Promise<WorkspaceNotificationPreferences> {
    const actor = await this.requireActor(args)
    const current = await this.getNotificationPreferences(args)
    const next = { ...current, ...args.preferences }
    const [row] = await this.db.insert(workspaceNotificationPreferences).values({
      workspaceId: args.workspaceId,
      principalId: actor.id,
      dmMessages: next.dmMessages,
      mentions: next.mentions,
      threadReplies: next.threadReplies,
      reactions: next.reactions,
      channelMessages: next.channelMessages,
      updatedAt: new Date(),
    }).onConflictDoUpdate({
      target: [workspaceNotificationPreferences.workspaceId, workspaceNotificationPreferences.principalId],
      set: {
        dmMessages: next.dmMessages,
        mentions: next.mentions,
        threadReplies: next.threadReplies,
        reactions: next.reactions,
        channelMessages: next.channelMessages,
        updatedAt: new Date(),
      },
    }).returning()
    return mapNotificationPreferences(row)
  }

  private async requireActor(args: { actorUserId: string; workspaceId: string }) {
    const [row] = await this.db.select({ principal: workspacePrincipals })
      .from(workspacePrincipals)
      .innerJoin(workspaceMemberships, and(
        eq(workspaceMemberships.workspaceId, workspacePrincipals.workspaceId),
        eq(workspaceMemberships.principalId, workspacePrincipals.id),
      ))
      .where(and(
        eq(workspacePrincipals.workspaceId, args.workspaceId),
        eq(workspacePrincipals.userId, args.actorUserId),
        eq(workspacePrincipals.type, 'human'),
        eq(workspaceMemberships.status, 'active'),
        isNull(workspacePrincipals.archivedAt),
      )).limit(1)
    if (!row) throw new Error('WORKSPACE_ACCESS_DENIED')
    return row.principal
  }

  private async requireModerator(args: {
    actorUserId: string
    conversationId: string
    workspaceId: string
  }) {
    const actor = await this.requireActor(args)
    const [row] = await this.db.select().from(conversationParticipants).where(and(
      eq(conversationParticipants.conversationId, args.conversationId),
      eq(conversationParticipants.principalId, actor.id),
      eq(conversationParticipants.status, 'active'),
      eq(conversationParticipants.role, 'moderator'),
    )).limit(1)
    if (!row) throw new Error('CONVERSATION_MODERATOR_REQUIRED')
    return actor
  }

  private async requireConversationMessage(args: {
    conversationId: string
    messageId: string
  }): Promise<void> {
    const [message] = await this.db.select({ id: conversationMessages.id })
      .from(conversationMessages)
      .where(and(
        eq(conversationMessages.id, args.messageId),
        eq(conversationMessages.conversationId, args.conversationId),
        isNull(conversationMessages.deletedAt),
      )).limit(1)
    if (!message) throw new Error('Message not found')
  }
}

function mapParticipant(
  row: typeof conversationParticipants.$inferSelect,
  principal: typeof workspacePrincipals.$inferSelect,
): ConversationParticipant {
  return {
    conversationId: row.conversationId,
    workspaceId: row.workspaceId,
    principalId: row.principalId,
    principalType: row.principalType as 'human' | 'agent',
    displayName: principal.displayName,
    email: principal.email ?? undefined,
    role: row.role,
    status: row.status,
    notificationLevel: row.notificationLevel,
    joinedAt: row.joinedAt.getTime(),
    updatedAt: row.updatedAt.getTime(),
    removedAt: row.removedAt?.getTime(),
    lastReadAt: row.lastReadAt?.getTime(),
    lastReadSequence: row.lastReadSequence ?? undefined,
    markedUnreadAt: row.markedUnreadAt?.getTime(),
    archivedAt: row.archivedAt?.getTime(),
  }
}

function mapAccessibleConversation(
  row: typeof conversations.$inferSelect,
): ConversationListRow {
  return {
    _id: row.id,
    userId: row.userId,
    clientId: row.clientId ?? undefined,
    title: row.title,
    lastModified: row.lastModified.getTime(),
    createdAt: row.createdAt.getTime(),
    updatedAt: (row.updatedAt ?? row.lastModified).getTime(),
    deletedAt: row.deletedAt?.getTime(),
    lastMode: row.lastMode,
    askModelIds: row.askModelIds,
    actModelId: row.actModelId,
    projectId: row.projectId ?? undefined,
    shareVisibility: row.shareVisibility ?? undefined,
    shareToken: row.shareToken,
    isAutomation: row.isAutomation ?? undefined,
    conversationType: row.conversationType,
    workspaceId: row.workspaceId ?? undefined,
  }
}

function mapCollaborationMessage(
  row: typeof conversationMessages.$inferSelect,
): ConversationMessageRow {
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
    createdAt: row.createdAt.getTime(),
    replyToTurnId: row.replyToTurnId ?? undefined,
    replySnippet: row.replySnippet ?? undefined,
    routedModelId: row.routedModelId ?? undefined,
    status: row.status ?? undefined,
    clientNonce: row.clientNonce ?? undefined,
    deletedAt: row.deletedAt?.getTime(),
    editedAt: row.editedAt?.getTime(),
    editHistory: row.editHistory ?? undefined,
    authorKind: row.authorKind as ConversationMessageRow['authorKind'],
    authorPrincipalId: row.authorPrincipalId ?? undefined,
    threadRootMessageId: row.threadRootMessageId ?? undefined,
  }
}

function mapPresence(
  row: typeof workspacePresence.$inferSelect,
  now: Date,
  overrides: { typing?: boolean } = {},
): ConversationPresence {
  const stale = now.getTime() - row.lastSeenAt.getTime() > 120_000
  return {
    workspaceId: row.workspaceId,
    principalId: row.principalId,
    sessionId: row.sessionId ?? undefined,
    conversationId: row.conversationId ?? undefined,
    status: stale ? 'offline' : row.status,
    typing: !stale && (overrides.typing ?? Boolean(row.typingExpiresAt && row.typingExpiresAt > now)),
    lastSeenAt: row.lastSeenAt.getTime(),
    typingExpiresAt: row.typingExpiresAt?.getTime(),
  }
}

function mapNotification(row: typeof workspaceNotifications.$inferSelect): WorkspaceNotification {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    recipientPrincipalId: row.recipientPrincipalId,
    type: row.type,
    conversationId: row.conversationId ?? undefined,
    messageId: row.messageId ?? undefined,
    actorPrincipalId: row.actorPrincipalId ?? undefined,
    threadRootMessageId: row.threadRootMessageId ?? undefined,
    eventSequence: row.eventSequence ?? undefined,
    mentionScope: row.mentionScope as WorkspaceNotification['mentionScope'],
    title: row.title,
    body: row.body ?? undefined,
    createdAt: row.createdAt.getTime(),
    readAt: row.readAt?.getTime(),
  }
}

function mapNotificationPreferences(
  row?: typeof workspaceNotificationPreferences.$inferSelect,
): WorkspaceNotificationPreferences {
  return {
    dmMessages: row?.dmMessages ?? 'activity',
    mentions: row?.mentions ?? 'banner',
    threadReplies: row?.threadReplies ?? 'activity',
    reactions: row?.reactions ?? 'activity',
    channelMessages: row?.channelMessages ?? 'activity',
  }
}

function mapChannel(
  row: typeof conversations.$inferSelect,
  participantCount: number,
): ChannelSummary {
  if (!row.channelSlug || !row.channelVisibility) throw new Error('Invalid channel record')
  return {
    conversationId: row.id,
    workspaceId: row.workspaceId ?? '',
    name: row.title,
    slug: row.channelSlug,
    topic: row.channelTopic ?? undefined,
    visibility: (row.channelVisibility as 'public' | 'private') ?? 'private',
    participantCount,
    createdAt: row.createdAt.getTime(),
    updatedAt: (row.updatedAt ?? row.lastModified).getTime(),
  }
}

function groupReactions(
  rows: Array<typeof conversationMessageReactions.$inferSelect>,
  currentPrincipalId: string,
): MessageReaction[] {
  const grouped = new Map<string, MessageReaction>()
  for (const row of rows) {
    const key = `${row.messageId}\0${row.emoji}`
    const existing = grouped.get(key) ?? {
      conversationId: row.conversationId,
      messageId: row.messageId,
      emoji: row.emoji,
      principalIds: [],
      count: 0,
      reactedByCurrentPrincipal: false,
    }
    existing.principalIds.push(row.principalId)
    existing.count += 1
    existing.reactedByCurrentPrincipal ||= row.principalId === currentPrincipalId
    grouped.set(key, existing)
  }
  return [...grouped.values()]
}

function cleanTitle(value?: string) {
  return value?.trim().replace(/\s+/g, ' ').slice(0, 120) ?? ''
}

function cleanTopic(value?: string) {
  return value?.trim().replace(/\s+/g, ' ').slice(0, 240) || undefined
}

function channelSlug(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
}

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('Expected persisted collaboration record')
  return value
}
