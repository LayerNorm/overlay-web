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
import type {
  ConversationEventRow,
  ConversationListRow,
  ConversationMessageRow,
} from './ActConversationRepository'

export interface ConversationCollaborationRepository {
  getAccessibleConversation(args: {
    actorUserId: string
    conversationId: string
    workspaceId: string
  }): Promise<ConversationListRow | null>
  listAccessibleConversations(args: {
    actorUserId: string
    workspaceId: string
  }): Promise<ConversationListRow[]>
  /** Conversations the actor archived. Subtracted from the main list; shown in Archived. */
  listArchivedConversations(args: {
    actorUserId: string
    workspaceId: string
  }): Promise<ConversationListRow[]>
  listMessages(args: {
    actorUserId: string
    beforeCreatedAt?: number
    conversationId: string
    limit: number
    mainOnly?: boolean
    messageId?: string
    threadRootMessageId?: string
    workspaceId: string
  }): Promise<ConversationMessageRow[]>
  addMessage(args: {
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
  }): Promise<string>
  addAgentMessage(args: {
    actorUserId: string
    authorPrincipalId: string
    clientNonce: string
    content: string
    conversationId: string
    modelId: string
    parts?: Array<Record<string, unknown>>
    threadRootMessageId?: string
    tokens?: { input: number; output: number }
    turnId: string
    workspaceId: string
  }): Promise<string>
  /**
   * Durable agent turn persistence. A room agent writes its reply as it is
   * generated rather than once at the end, so the transcript itself — not a
   * client-held stream — is what survives a reload and what every other
   * participant reads. `startAgentMessage` is idempotent on `clientNonce`, so a
   * retried or replayed turn reuses the same row instead of posting twice.
   */
  startAgentMessage(args: {
    actorUserId: string
    authorPrincipalId: string
    clientNonce: string
    conversationId: string
    modelId: string
    threadRootMessageId?: string
    turnId: string
    workspaceId: string
  }): Promise<string>
  /**
   * Opens a durable room agent turn: the reply row plus the run record that
   * owns it, before the model is called. `resumed` reports that a turn for this
   * (message, agent) already existed, which is how a duplicate trigger avoids
   * starting a second workflow against the same reply.
   */
  startAgentTurn(args: {
    actorUserId: string
    agentId: string
    authorPrincipalId: string
    clientNonce: string
    conversationId: string
    modelId: string
    threadRootMessageId?: string
    turnId: string
    userMessageId: string
    workspaceId: string
  }): Promise<{ messageId: string; resumed: boolean; runId: string }>
  appendAgentMessageDelta(args: {
    actorUserId: string
    contentDelta: string
    conversationId: string
    /** Full replacement for the row's parts; omitted when only text advanced. */
    parts?: Array<Record<string, unknown>>
    /** Publishes `message.delta`. Throttled by the caller, not per flush. */
    emitEvent?: boolean
    messageId: string
    workspaceId: string
  }): Promise<void>
  finalizeAgentMessage(args: {
    actorUserId: string
    content: string
    conversationId: string
    messageId: string
    parts?: Array<Record<string, unknown>>
    tokens?: { input: number; output: number }
    workspaceId: string
  }): Promise<void>
  failAgentMessage(args: {
    actorUserId: string
    conversationId: string
    /** Partial text is kept: a truncated reply beats a vanished one. */
    content?: string
    messageId: string
    parts?: Array<Record<string, unknown>>
    workspaceId: string
  }): Promise<void>
  getConversationEventCursor(args: {
    actorUserId: string
    workspaceId: string
  }): Promise<number>
  listConversationEvents(args: {
    actorUserId: string
    afterSequence: number
    limit: number
    workspaceId: string
  }): Promise<ConversationEventRow[]>
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
  archiveConversationForEveryone(args: {
    actorUserId: string
    archived: boolean
    conversationId: string
    workspaceId: string
  }): Promise<ConversationParticipant>
  deleteConversationForEveryone(args: {
    actorUserId: string
    conversationId: string
    workspaceId: string
  }): Promise<boolean>
  deleteAllConversations(args: {
    actorUserId: string
    workspaceId: string
  }): Promise<{ conversationsDeleted: number; participantsRemoved: number }>
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
    conversationId?: string
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
