import 'server-only'

import { createHash, randomUUID } from 'node:crypto'
import { and, desc, eq, inArray, isNull, ne } from 'drizzle-orm'
import { DEFAULT_MODEL_ID } from '@/shared/ai/gateway/model-types'
import type { OverlayPostgresDb } from '@/server/database/postgres/client'
import {
  conversationEvents,
  conversationMessages,
  conversationParticipants,
  conversations,
  workspaceMemberships,
  workspaceNotifications,
  workspacePresence,
  workspacePrincipals,
  workspaceResourceScopes,
} from '@/server/database/postgres/schema'
import type {
  ConversationParticipant,
  ConversationPresence,
  DirectMessageSummary,
  WorkspaceNotification,
} from '@overlay/workspace-contracts'
import type { ConversationCollaborationRepository } from './ConversationCollaborationRepository'

export class PostgresConversationCollaborationRepository
implements ConversationCollaborationRepository {
  constructor(private readonly db: OverlayPostgresDb) {}

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

      if (args.sourceConversationId) {
        const sourceMessages = await tx.select().from(conversationMessages)
          .where(eq(conversationMessages.conversationId, args.sourceConversationId))
          .orderBy(conversationMessages.createdAt)
        if (sourceMessages.length > 0) {
          await tx.insert(conversationMessages).values(sourceMessages.map((message) => ({
            ...message,
            id: `message_${randomUUID()}`,
            conversationId,
            clientNonce: undefined,
          })))
        }
      }

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
    workspaceId: string
  }): Promise<ConversationParticipant> {
    const actor = await this.requireActor(args)
    if (!await this.canAccessConversation(args)) throw new Error('CONVERSATION_ACCESS_DENIED')
    const now = new Date()
    const [row] = await this.db.update(conversationParticipants).set({
      ...(args.notificationLevel ? { notificationLevel: args.notificationLevel } : {}),
      ...(args.archived !== undefined ? { archivedAt: args.archived ? now : null } : {}),
      ...(args.markRead ? { lastReadAt: now, markedUnreadAt: null } : {}),
      ...(args.markUnread ? { markedUnreadAt: now } : {}),
      updatedAt: now,
    }).where(and(
      eq(conversationParticipants.conversationId, args.conversationId),
      eq(conversationParticipants.principalId, actor.id),
      eq(conversationParticipants.status, 'active'),
    )).returning()
    if (!row) throw new Error('CONVERSATION_ACCESS_DENIED')
    return mapParticipant(row, actor)
  }

  async upsertPresence(args: {
    actorUserId: string
    conversationId?: string
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
    const typingExpiresAt = args.typing && args.conversationId
      ? new Date(now.getTime() + 6_000)
      : null
    const [row] = await this.db.insert(workspacePresence).values({
      workspaceId: args.workspaceId,
      principalId: actor.id,
      conversationId: args.conversationId,
      status: args.status,
      lastSeenAt: now,
      typingExpiresAt,
      updatedAt: now,
    }).onConflictDoUpdate({
      target: [workspacePresence.workspaceId, workspacePresence.principalId],
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
      .where(eq(workspacePresence.workspaceId, args.workspaceId))
    const now = new Date()
    return rows.map((row) => mapPresence(row.workspace_presence, now))
  }

  async recordMessageActivity(args: {
    actorUserId: string
    body?: string
    conversationId: string
    mentionedPrincipalIds?: string[]
    messageId: string
    workspaceId: string
  }): Promise<void> {
    const actor = await this.requireActor(args)
    if (!await this.canAccessConversation(args)) throw new Error('CONVERSATION_ACCESS_DENIED')
    const now = new Date()
    const participants = await this.db.select().from(conversationParticipants).where(and(
      eq(conversationParticipants.conversationId, args.conversationId),
      eq(conversationParticipants.status, 'active'),
      ne(conversationParticipants.principalId, actor.id),
    ))
    const mentions = new Set(args.mentionedPrincipalIds ?? [])
    const recipients = participants.filter((participant) => (
      participant.notificationLevel !== 'muted'
      && (participant.notificationLevel !== 'mentions' || mentions.has(participant.principalId))
    ))
    await this.db.transaction(async (tx) => {
      await tx.update(conversationParticipants).set({
        lastReadAt: now,
        markedUnreadAt: null,
        updatedAt: now,
      }).where(and(
        eq(conversationParticipants.conversationId, args.conversationId),
        eq(conversationParticipants.principalId, actor.id),
      ))
      if (recipients.length > 0) {
        await tx.insert(workspaceNotifications).values(recipients.map((recipient) => ({
          id: `notification_${randomUUID()}`,
          workspaceId: args.workspaceId,
          recipientPrincipalId: recipient.principalId,
          type: mentions.has(recipient.principalId) ? 'mention' as const : 'message' as const,
          conversationId: args.conversationId,
          messageId: args.messageId,
          actorPrincipalId: actor.id,
          title: mentions.has(recipient.principalId)
            ? `${actor.displayName} mentioned you`
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
    const rows = await this.db.update(conversationMessages).set({
      content,
      editedAt: now,
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

  async listNotifications(args: {
    actorUserId: string
    limit?: number
    unreadOnly?: boolean
    workspaceId: string
  }): Promise<WorkspaceNotification[]> {
    const actor = await this.requireActor(args)
    const rows = await this.db.select().from(workspaceNotifications).where(and(
      eq(workspaceNotifications.workspaceId, args.workspaceId),
      eq(workspaceNotifications.recipientPrincipalId, actor.id),
      args.unreadOnly ? isNull(workspaceNotifications.readAt) : undefined,
    )).orderBy(desc(workspaceNotifications.createdAt))
      .limit(Math.max(1, Math.min(100, args.limit ?? 50)))
    return rows.map(mapNotification)
  }

  async markNotificationsRead(args: {
    actorUserId: string
    notificationIds?: string[]
    workspaceId: string
  }): Promise<number> {
    const actor = await this.requireActor(args)
    const rows = await this.db.update(workspaceNotifications).set({ readAt: new Date() }).where(and(
      eq(workspaceNotifications.workspaceId, args.workspaceId),
      eq(workspaceNotifications.recipientPrincipalId, actor.id),
      isNull(workspaceNotifications.readAt),
      args.notificationIds?.length
        ? inArray(workspaceNotifications.id, args.notificationIds)
        : undefined,
    )).returning({ id: workspaceNotifications.id })
    return rows.length
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
    markedUnreadAt: row.markedUnreadAt?.getTime(),
    archivedAt: row.archivedAt?.getTime(),
  }
}

function mapPresence(
  row: typeof workspacePresence.$inferSelect,
  now: Date,
): ConversationPresence {
  const stale = now.getTime() - row.lastSeenAt.getTime() > 120_000
  return {
    workspaceId: row.workspaceId,
    principalId: row.principalId,
    conversationId: row.conversationId ?? undefined,
    status: stale ? 'offline' : row.status,
    typing: !stale && Boolean(row.typingExpiresAt && row.typingExpiresAt > now),
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
    title: row.title,
    body: row.body ?? undefined,
    createdAt: row.createdAt.getTime(),
    readAt: row.readAt?.getTime(),
  }
}

function cleanTitle(value?: string) {
  return value?.trim().replace(/\s+/g, ' ').slice(0, 120) ?? ''
}

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('Expected persisted collaboration record')
  return value
}
