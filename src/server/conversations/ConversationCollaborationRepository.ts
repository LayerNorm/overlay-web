import 'server-only'

import type {
  ConversationNotificationLevel,
  ConversationParticipant,
  ConversationParticipantStateInput,
  ConversationPin,
  ConversationPresence,
  ConversationSavedMessage,
  ChannelCreateInput,
  ChannelSummary,
  DirectMessageCreateInput,
  DirectMessageSummary,
  MessageReaction,
  WorkspaceChatSearchResult,
  WorkspaceNotification,
  WorkspaceNotificationFilter,
  WorkspaceNotificationPreferences,
  ConversationThreadFollow,
} from '@overlay/workspace-contracts'

export interface ConversationCollaborationRepository {
  createChannel(args: ChannelCreateInput & {
    actorUserId: string
    workspaceId: string
  }): Promise<ChannelSummary>
  listChannels(args: {
    actorUserId: string
    workspaceId: string
  }): Promise<ChannelSummary[]>
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
    sessionId?: string
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
    threadRootMessageId?: string
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
  listReactions(args: {
    actorUserId: string
    conversationId: string
    workspaceId: string
  }): Promise<MessageReaction[]>
  setReaction(args: {
    actorUserId: string
    conversationId: string
    emoji: string
    enabled: boolean
    messageId: string
    workspaceId: string
  }): Promise<MessageReaction[]>
  listPins(args: {
    actorUserId: string
    conversationId: string
    workspaceId: string
  }): Promise<ConversationPin[]>
  setPinned(args: {
    actorUserId: string
    conversationId: string
    messageId: string
    pinned: boolean
    workspaceId: string
  }): Promise<boolean>
  listSavedMessages(args: {
    actorUserId: string
    workspaceId: string
  }): Promise<ConversationSavedMessage[]>
  setSaved(args: {
    actorUserId: string
    conversationId: string
    messageId: string
    saved: boolean
    workspaceId: string
  }): Promise<boolean>
  searchWorkspaceChats(args: {
    actorUserId: string
    limit?: number
    query: string
    workspaceId: string
  }): Promise<WorkspaceChatSearchResult[]>
  listNotifications(args: {
    actorUserId: string
    filter?: WorkspaceNotificationFilter
    limit?: number
    unreadOnly?: boolean
    workspaceId: string
  }): Promise<WorkspaceNotification[]>
  markNotificationsRead(args: {
    actorUserId: string
    notificationIds?: string[]
    workspaceId: string
  }): Promise<number>
  setThreadFollow(args: {
    actorUserId: string
    conversationId: string
    threadRootMessageId: string
    followed: boolean
    workspaceId: string
  }): Promise<boolean>
  listThreadFollows(args: {
    actorUserId: string
    conversationId: string
    threadRootMessageId?: string
    workspaceId: string
  }): Promise<ConversationThreadFollow[]>
  getNotificationPreferences(args: {
    actorUserId: string
    workspaceId: string
  }): Promise<WorkspaceNotificationPreferences>
  updateNotificationPreferences(args: {
    actorUserId: string
    workspaceId: string
    preferences: Partial<WorkspaceNotificationPreferences>
  }): Promise<WorkspaceNotificationPreferences>
}

export type ConversationParticipantStatePatch = {
  archivedAt?: Date | null
  lastReadAt?: Date | null
  markedUnreadAt?: Date | null
  notificationLevel?: ConversationNotificationLevel
}
