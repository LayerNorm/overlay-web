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
} from '@overlay/workspace-contracts'
import { lazyConvex as convex } from '@/server/database/lazy-convex'
import { getInternalApiSecret } from '@/server/shared/internal-api-secret'
import type { Id } from '../../../convex/_generated/dataModel'
import type { ConversationCollaborationRepository } from './ConversationCollaborationRepository'

export class ConvexConversationCollaborationRepository
implements ConversationCollaborationRepository {
  private get serverSecret() {
    return getInternalApiSecret()
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
    workspaceId: string
  }) {
    await convex.mutation('collaboration/directMessages:recordMessageActivity', {
      ...args,
      conversationId: args.conversationId as Id<'conversations'>,
      messageId: args.messageId as Id<'conversationMessages'>,
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
    notificationIds?: string[]
    workspaceId: string
  }) {
    return await convex.mutation<number>('collaboration/directMessages:markNotificationsRead', {
      ...args,
      serverSecret: this.serverSecret,
    }, { throwOnError: true }) ?? 0
  }
}
