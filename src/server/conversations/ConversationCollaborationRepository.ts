import 'server-only'

import type {
  ConversationNotificationLevel,
  ConversationParticipant,
  ConversationParticipantStateInput,
  ConversationPresence,
  DirectMessageCreateInput,
  DirectMessageSummary,
  WorkspaceNotification,
} from '@overlay/workspace-contracts'

export interface ConversationCollaborationRepository {
  createDirectMessage(args: DirectMessageCreateInput & {
    actorUserId: string
    workspaceId: string
  }): Promise<DirectMessageSummary>
  listAccessibleConversationIds(args: {
    actorUserId: string
    workspaceId: string
  }): Promise<string[]>
  canAccessConversation(args: {
    actorUserId: string
    conversationId: string
    workspaceId: string
  }): Promise<boolean>
  listParticipants(args: {
    actorUserId: string
    conversationId: string
    workspaceId: string
  }): Promise<ConversationParticipant[]>
  addParticipant(args: {
    actorUserId: string
    conversationId: string
    principalId: string
    workspaceId: string
  }): Promise<ConversationParticipant>
  removeParticipant(args: {
    actorUserId: string
    conversationId: string
    principalId: string
    workspaceId: string
  }): Promise<boolean>
  updateParticipantState(args: ConversationParticipantStateInput & {
    actorUserId: string
    conversationId: string
    workspaceId: string
  }): Promise<ConversationParticipant>
  upsertPresence(args: {
    actorUserId: string
    conversationId?: string
    status: 'online' | 'away' | 'offline'
    typing?: boolean
    workspaceId: string
  }): Promise<ConversationPresence>
  listPresence(args: {
    actorUserId: string
    conversationId: string
    workspaceId: string
  }): Promise<ConversationPresence[]>
  recordMessageActivity(args: {
    actorUserId: string
    body?: string
    conversationId: string
    mentionedPrincipalIds?: string[]
    messageId: string
    workspaceId: string
  }): Promise<void>
  editMessage(args: {
    actorUserId: string
    content: string
    conversationId: string
    messageId: string
    workspaceId: string
  }): Promise<boolean>
  deleteMessage(args: {
    actorUserId: string
    conversationId: string
    messageId: string
    workspaceId: string
  }): Promise<boolean>
  listNotifications(args: {
    actorUserId: string
    limit?: number
    unreadOnly?: boolean
    workspaceId: string
  }): Promise<WorkspaceNotification[]>
  markNotificationsRead(args: {
    actorUserId: string
    notificationIds?: string[]
    workspaceId: string
  }): Promise<number>
}

export type ConversationParticipantStatePatch = {
  archivedAt?: Date | null
  lastReadAt?: Date | null
  markedUnreadAt?: Date | null
  notificationLevel?: ConversationNotificationLevel
}
