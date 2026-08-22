import 'server-only'

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
import { lazyConvex as convex } from '@/server/database/lazy-convex'
import { getInternalApiSecret } from '@/server/shared/internal-api-secret'
import type { Id } from '../../../convex/_generated/dataModel'
import type { ConversationCollaborationRepository } from './ConversationCollaborationRepository'
import type {
  ConversationEventRow,
  ConversationListRow,
  ConversationMessageRow,
} from './ActConversationRepository'

export class ConvexConversationCollaborationRepository
implements ConversationCollaborationRepository {
  private get serverSecret() {
    return getInternalApiSecret()
  }

  async getAccessibleConversation(args: {
    actorUserId: string
    conversationId: string
    workspaceId: string
  }) {
    return await convex.query<ConversationListRow | null>('collaboration/directMessages:getAccessibleConversation', {
      ...args,
      conversationId: args.conversationId as Id<'conversations'>,
      serverSecret: this.serverSecret,
    })
  }

  async listAccessibleConversations(args: { actorUserId: string; workspaceId: string }) {
    return await convex.query<ConversationListRow[]>('collaboration/directMessages:listAccessibleConversations', {
      ...args,
      serverSecret: this.serverSecret,
    }) ?? []
  }

  async listArchivedConversations(args: { actorUserId: string; workspaceId: string }) {
    return await convex.query<ConversationListRow[]>('collaboration/directMessages:listArchivedConversations', {
      ...args,
      serverSecret: this.serverSecret,
    }) ?? []
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
  }) {
    return await convex.query<ConversationMessageRow[]>('collaboration/directMessages:listMessages', {
      ...args,
      conversationId: args.conversationId as Id<'conversations'>,
      messageId: args.messageId as Id<'conversationMessages'> | undefined,
      threadRootMessageId: args.threadRootMessageId as Id<'conversationMessages'> | undefined,
      serverSecret: this.serverSecret,
    }, { throwOnError: true }) ?? []
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
  }) {
    const id = await convex.mutation<string>('collaboration/directMessages:addMessage', {
      ...args,
      conversationId: args.conversationId as Id<'conversations'>,
      threadRootMessageId: args.threadRootMessageId as Id<'conversationMessages'> | undefined,
      serverSecret: this.serverSecret,
    }, { throwOnError: true })
    if (!id) throw new Error('Failed to save collaboration message')
    return id
  }

  async addAgentMessage(args: {
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
  }) {
    const id = await convex.mutation<string>('collaboration/directMessages:addAgentMessage', {
      ...args,
      conversationId: args.conversationId as Id<'conversations'>,
      threadRootMessageId: args.threadRootMessageId as Id<'conversationMessages'> | undefined,
      serverSecret: this.serverSecret,
    }, { throwOnError: true })
    if (!id) throw new Error('Failed to save collaboration agent message')
    return id
  }

  async startAgentMessage(args: {
    actorUserId: string
    authorPrincipalId: string
    clientNonce: string
    conversationId: string
    modelId: string
    threadRootMessageId?: string
    turnId: string
    workspaceId: string
  }) {
    const id = await convex.mutation<string>('collaboration/directMessages:startAgentMessage', {
      ...args,
      conversationId: args.conversationId as Id<'conversations'>,
      threadRootMessageId: args.threadRootMessageId as Id<'conversationMessages'> | undefined,
      serverSecret: this.serverSecret,
    }, { throwOnError: true })
    if (!id) throw new Error('Failed to open collaboration agent message')
    return id
  }

  async appendAgentMessageDelta(args: {
    actorUserId: string
    contentDelta: string
    conversationId: string
    emitEvent?: boolean
    messageId: string
    parts?: Array<Record<string, unknown>>
    workspaceId: string
  }) {
    await convex.mutation('collaboration/directMessages:appendAgentMessageDelta', {
      ...args,
      conversationId: args.conversationId as Id<'conversations'>,
      messageId: args.messageId as Id<'conversationMessages'>,
      serverSecret: this.serverSecret,
    }, { throwOnError: true })
  }

  async finalizeAgentMessage(args: {
    actorUserId: string
    content: string
    conversationId: string
    messageId: string
    parts?: Array<Record<string, unknown>>
    tokens?: { input: number; output: number }
    workspaceId: string
  }) {
    await convex.mutation('collaboration/directMessages:finalizeAgentMessage', {
      ...args,
      conversationId: args.conversationId as Id<'conversations'>,
      messageId: args.messageId as Id<'conversationMessages'>,
      serverSecret: this.serverSecret,
    }, { throwOnError: true })
  }

  async failAgentMessage(args: {
    actorUserId: string
    content?: string
    conversationId: string
    messageId: string
    parts?: Array<Record<string, unknown>>
    workspaceId: string
  }) {
    await convex.mutation('collaboration/directMessages:failAgentMessage', {
      ...args,
      conversationId: args.conversationId as Id<'conversations'>,
      messageId: args.messageId as Id<'conversationMessages'>,
      serverSecret: this.serverSecret,
    }, { throwOnError: true })
  }

  async getConversationEventCursor(args: { actorUserId: string; workspaceId: string }) {
    return await convex.query<number>('collaboration/directMessages:getConversationEventCursor', {
      ...args,
      serverSecret: this.serverSecret,
    }) ?? 0
  }

  async listConversationEvents(args: {
    actorUserId: string
    afterSequence: number
    limit: number
    workspaceId: string
  }): Promise<ConversationEventRow[]> {
    return await convex.query<ConversationEventRow[]>('collaboration/directMessages:listConversationEvents', {
      ...args,
      serverSecret: this.serverSecret,
    }) ?? []
  }

  async createChannel(args: {
    actorUserId: string
    name: string
    principalIds?: string[]
    topic?: string
    visibility: 'public' | 'private'
    workspaceId: string
  }) {
    return await convex.mutation<ChannelSummary>('collaboration/channels:createChannel', {
      ...args,
      serverSecret: this.serverSecret,
    }, { throwOnError: true }) as ChannelSummary
  }

  async listChannels(args: { actorUserId: string; workspaceId: string }) {
    return await convex.query<ChannelSummary[]>('collaboration/channels:listChannels', {
      ...args,
      serverSecret: this.serverSecret,
    }, { throwOnError: true }) ?? []
  }

  async createDirectMessage(args: {
    actorUserId: string
    principalIds: string[]
    sourceConversationId?: string
    title?: string
    workspaceId: string
  }): Promise<DirectMessageSummary> {
    return await convex.mutation<DirectMessageSummary>('collaboration/directMessages:createDirectMessage', {
      ...args,
      sourceConversationId: args.sourceConversationId as Id<'conversations'> | undefined,
      serverSecret: this.serverSecret,
    }, { throwOnError: true }) as DirectMessageSummary
  }

  async listAccessibleConversationIds(args: { actorUserId: string; workspaceId: string }) {
    return await convex.query<string[]>('collaboration/directMessages:accessibleConversationIds', {
      ...args,
      serverSecret: this.serverSecret,
    }) ?? []
  }

  async canAccessConversation(args: {
    actorUserId: string
    conversationId: string
    workspaceId: string
  }) {
    return await convex.query<boolean>('collaboration/directMessages:canAccessConversation', {
      ...args,
      conversationId: args.conversationId as Id<'conversations'>,
      serverSecret: this.serverSecret,
    }) ?? false
  }

  async listParticipants(args: {
    actorUserId: string
    conversationId: string
    workspaceId: string
  }) {
    return await convex.query<ConversationParticipant[]>('collaboration/directMessages:listParticipants', {
      ...args,
      conversationId: args.conversationId as Id<'conversations'>,
      serverSecret: this.serverSecret,
    }, { throwOnError: true }) ?? []
  }

  async addParticipant(args: {
    actorUserId: string
    conversationId: string
    principalId: string
    workspaceId: string
  }) {
    return await convex.mutation<ConversationParticipant>('collaboration/directMessages:addParticipant', {
      ...args,
      conversationId: args.conversationId as Id<'conversations'>,
      serverSecret: this.serverSecret,
    }, { throwOnError: true }) as ConversationParticipant
  }

  async removeParticipant(args: {
    actorUserId: string
    conversationId: string
    principalId: string
    workspaceId: string
  }) {
    return await convex.mutation<boolean>('collaboration/directMessages:removeParticipant', {
      ...args,
      conversationId: args.conversationId as Id<'conversations'>,
      serverSecret: this.serverSecret,
    }, { throwOnError: true }) ?? false
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
  }) {
    return await convex.mutation<ConversationParticipant>('collaboration/directMessages:updateParticipantState', {
      ...args,
      conversationId: args.conversationId as Id<'conversations'>,
      serverSecret: this.serverSecret,
    }, { throwOnError: true }) as ConversationParticipant
  }

  async archiveConversationForEveryone(args: {
    actorUserId: string
    archived: boolean
    conversationId: string
    workspaceId: string
  }) {
    return await convex.mutation<ConversationParticipant>('collaboration/directMessages:archiveConversationForEveryone', {
      ...args,
      conversationId: args.conversationId as Id<'conversations'>,
      serverSecret: this.serverSecret,
    }, { throwOnError: true }) as ConversationParticipant
  }

  async deleteConversationForEveryone(args: {
    actorUserId: string
    conversationId: string
    workspaceId: string
  }) {
    return await convex.mutation<boolean>('collaboration/directMessages:deleteConversationForEveryone', {
      ...args,
      conversationId: args.conversationId as Id<'conversations'>,
      serverSecret: this.serverSecret,
    }, { throwOnError: true }) ?? false
  }

  async deleteAllConversations(args: {
    actorUserId: string
    workspaceId: string
  }) {
    return await convex.mutation<{ conversationsDeleted: number; participantsRemoved: number }>(
      'collaboration/channels:deleteAllConversations',
      { ...args, serverSecret: this.serverSecret },
      { throwOnError: true },
    ) ?? { conversationsDeleted: 0, participantsRemoved: 0 }
  }

  async upsertPresence(args: {
    actorUserId: string
    conversationId?: string
    sessionId?: string
    status: 'online' | 'away' | 'offline'
    typing?: boolean
    workspaceId: string
  }) {
    return await convex.mutation<ConversationPresence>('collaboration/directMessages:upsertPresence', {
      ...args,
      conversationId: args.conversationId as Id<'conversations'> | undefined,
      serverSecret: this.serverSecret,
    }, { throwOnError: true }) as ConversationPresence
  }

  async listPresence(args: {
    actorUserId: string
    conversationId: string
    workspaceId: string
  }) {
    return await convex.query<ConversationPresence[]>('collaboration/directMessages:listPresence', {
      ...args,
      conversationId: args.conversationId as Id<'conversations'>,
      serverSecret: this.serverSecret,
    }, { throwOnError: true }) ?? []
  }

  async recordMessageActivity(args: {
    actorUserId: string
    body?: string
    conversationId: string
    mentionedPrincipalIds?: string[]
    messageId: string
    threadRootMessageId?: string
    workspaceId: string
  }) {
    await convex.mutation('collaboration/directMessages:recordMessageActivity', {
      ...args,
      conversationId: args.conversationId as Id<'conversations'>,
      messageId: args.messageId as Id<'conversationMessages'>,
      threadRootMessageId: args.threadRootMessageId as Id<'conversationMessages'> | undefined,
      serverSecret: this.serverSecret,
    }, { throwOnError: true })
  }

  async editMessage(args: {
    actorUserId: string
    content: string
    conversationId: string
    messageId: string
    workspaceId: string
  }) {
    return await convex.mutation<boolean>('collaboration/directMessages:editMessage', {
      ...args,
      conversationId: args.conversationId as Id<'conversations'>,
      messageId: args.messageId as Id<'conversationMessages'>,
      serverSecret: this.serverSecret,
    }, { throwOnError: true }) ?? false
  }

  async deleteMessage(args: {
    actorUserId: string
    conversationId: string
    messageId: string
    workspaceId: string
  }) {
    return await convex.mutation<boolean>('collaboration/directMessages:deleteMessage', {
      ...args,
      conversationId: args.conversationId as Id<'conversations'>,
      messageId: args.messageId as Id<'conversationMessages'>,
      serverSecret: this.serverSecret,
    }, { throwOnError: true }) ?? false
  }

  async listReactions(args: {
    actorUserId: string
    conversationId: string
    workspaceId: string
  }) {
    return await convex.query<MessageReaction[]>('collaboration/channels:listReactions', {
      ...args,
      conversationId: args.conversationId as Id<'conversations'>,
      serverSecret: this.serverSecret,
    }, { throwOnError: true }) ?? []
  }

  async setReaction(args: {
    actorUserId: string
    conversationId: string
    emoji: string
    enabled: boolean
    messageId: string
    workspaceId: string
  }) {
    return await convex.mutation<MessageReaction[]>('collaboration/channels:setReaction', {
      ...args,
      conversationId: args.conversationId as Id<'conversations'>,
      messageId: args.messageId as Id<'conversationMessages'>,
      serverSecret: this.serverSecret,
    }, { throwOnError: true }) ?? []
  }

  async listPins(args: {
    actorUserId: string
    conversationId: string
    workspaceId: string
  }) {
    return await convex.query<ConversationPin[]>('collaboration/channels:listPins', {
      ...args,
      conversationId: args.conversationId as Id<'conversations'>,
      serverSecret: this.serverSecret,
    }, { throwOnError: true }) ?? []
  }

  async setPinned(args: {
    actorUserId: string
    conversationId: string
    messageId: string
    pinned: boolean
    workspaceId: string
  }) {
    return await convex.mutation<boolean>('collaboration/channels:setPinned', {
      ...args,
      conversationId: args.conversationId as Id<'conversations'>,
      messageId: args.messageId as Id<'conversationMessages'>,
      serverSecret: this.serverSecret,
    }, { throwOnError: true }) ?? false
  }

  async listSavedMessages(args: { actorUserId: string; workspaceId: string }) {
    return await convex.query<ConversationSavedMessage[]>('collaboration/channels:listSavedMessages', {
      ...args,
      serverSecret: this.serverSecret,
    }, { throwOnError: true }) ?? []
  }

  async setSaved(args: {
    actorUserId: string
    conversationId: string
    messageId: string
    saved: boolean
    workspaceId: string
  }) {
    return await convex.mutation<boolean>('collaboration/channels:setSaved', {
      ...args,
      conversationId: args.conversationId as Id<'conversations'>,
      messageId: args.messageId as Id<'conversationMessages'>,
      serverSecret: this.serverSecret,
    }, { throwOnError: true }) ?? false
  }

  async searchWorkspaceChats(args: {
    actorUserId: string
    limit?: number
    query: string
    workspaceId: string
  }) {
    return await convex.query<WorkspaceChatSearchResult[]>('collaboration/channels:searchWorkspaceChats', {
      ...args,
      serverSecret: this.serverSecret,
    }, { throwOnError: true }) ?? []
  }

  async listNotifications(args: {
    actorUserId: string
    filter?: WorkspaceNotificationFilter
    limit?: number
    unreadOnly?: boolean
    workspaceId: string
  }) {
    return await convex.query<WorkspaceNotification[]>('collaboration/directMessages:listNotifications', {
      ...args,
      serverSecret: this.serverSecret,
    }, { throwOnError: true }) ?? []
  }

  async markNotificationsRead(args: {
    actorUserId: string
    conversationId?: string
    notificationIds?: string[]
    workspaceId: string
  }) {
    return await convex.mutation<number>('collaboration/directMessages:markNotificationsRead', {
      ...args,
      conversationId: args.conversationId as Id<'conversations'> | undefined,
      serverSecret: this.serverSecret,
    }, { throwOnError: true }) ?? 0
  }

  async setThreadFollow(args: {
    actorUserId: string
    conversationId: string
    threadRootMessageId: string
    followed: boolean
    workspaceId: string
  }) {
    return await convex.mutation<boolean>('collaboration/directMessages:setThreadFollow', {
      ...args,
      conversationId: args.conversationId as Id<'conversations'>,
      threadRootMessageId: args.threadRootMessageId as Id<'conversationMessages'>,
      serverSecret: this.serverSecret,
    }, { throwOnError: true }) ?? false
  }

  async listThreadFollows(args: {
    actorUserId: string
    conversationId: string
    threadRootMessageId?: string
    workspaceId: string
  }) {
    return await convex.query<ConversationThreadFollow[]>('collaboration/directMessages:listThreadFollows', {
      ...args,
      conversationId: args.conversationId as Id<'conversations'>,
      threadRootMessageId: args.threadRootMessageId as Id<'conversationMessages'> | undefined,
      serverSecret: this.serverSecret,
    }, { throwOnError: true }) ?? []
  }

  async getNotificationPreferences(args: { actorUserId: string; workspaceId: string }) {
    return await convex.query<WorkspaceNotificationPreferences>('collaboration/directMessages:getNotificationPreferences', {
      ...args,
      serverSecret: this.serverSecret,
    }, { throwOnError: true }) ?? {
      dmMessages: 'activity',
      mentions: 'banner',
      threadReplies: 'activity',
      reactions: 'activity',
      channelMessages: 'activity',
    }
  }

  async updateNotificationPreferences(args: {
    actorUserId: string
    workspaceId: string
    preferences: Partial<WorkspaceNotificationPreferences>
  }) {
    return await convex.mutation<WorkspaceNotificationPreferences>('collaboration/directMessages:updateNotificationPreferences', {
      ...args,
      ...args.preferences,
      serverSecret: this.serverSecret,
    }, { throwOnError: true }) as WorkspaceNotificationPreferences
  }
}
