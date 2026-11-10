import { anyApi, type FunctionReference } from 'convex/server'
import type { GenericId } from 'convex/values'
import type { ConversationMessage } from '@overlay/app-core'
import type {
  ChannelSummary, ConversationParticipant, ConversationPin, ConversationPresence,
  ConversationSavedMessage, ConversationThreadFollow, MessageReaction,
  WorkspaceManagementResponse, WorkspaceNotification, WorkspaceSummary,
} from '@overlay/workspace-contracts'
import type { RoomMessageRecord } from '../lib/roomMessages'
import type { ActivePublicStreamSnapshot, PublicStreamCheckpoint } from '../../src/shared/chat/public-stream-projection'

export type Id<Table extends string> = GenericId<Table>
type Query<A extends Record<string, unknown>, R> = FunctionReference<'query', 'public', A, R>
type Mutation<A extends Record<string, unknown>, R = null> = FunctionReference<'mutation', 'public', A, R>
type RoomArgs = { workspaceId: string; conversationId: Id<'conversations'> }
type MessageArgs = RoomArgs & { messageId: Id<'conversationMessages'> }
type PageArgs = { paginationOpts: { numItems: number; cursor: string | null } }
type Page<T> = { page: T[]; isDone: boolean; continueCursor: string }
type Preferences = { askModelIds: string[]; actModelId: string; lastMode: 'ask' | 'act' }
export type PersonalSummary = { workspaceId: string } & Preferences & {
  _id: Id<'conversations'>; title: string; createdAt: number; lastModified: number;
  conversationType: 'personal'; scope: 'personal' | 'workspace'; kind: 'personal' | 'workspace' | 'automation';
  archivedAt?: number; lastReadAt?: number; markedUnreadAt?: number; lastMessageId?: Id<'conversationMessages'>; lastMessageAt?: number; unread: boolean;
}
type NativeMessage = Omit<ConversationMessage, 'id'> & { _id: Id<'conversationMessages'>; content: string; createdAt: number; status?: 'generating' | 'completed' | 'error'; publicStreamCheckpoint?: PublicStreamCheckpoint }
export type PersonalMessageRow = { message: NativeMessage; contextUser: NativeMessage | null; outputs: unknown[] }
type RoomAccess = { title: string; conversationType: 'dm' | 'channel'; externalPlatform: string | null }
type RoomState = {
  currentPrincipalId: string; channel: ChannelSummary | null;
  participants: ConversationParticipant[]; reactions: MessageReaction[]; pins: ConversationPin[];
  saved: ConversationSavedMessage[]; follows: ConversationThreadFollow[]; presence: ConversationPresence[];
}
type NamedResource = { id: string; name?: string; description?: string }
export type BrowseMentions = {
  query: string; chats: Array<{ id: string; title: string }>;
  files: Array<{ id: string; name: string; kind?: string; mimeType?: string }>;
  automations: NamedResource[]; skills: NamedResource[]; mcpServers: NamedResource[]; connectorsAllowed: boolean;
}

// The generated declaration imports the entire web backend and its web-only aliases.
// Keep this public native surface aligned with convex/{chat/personal,collaboration/*,search/browse}.
type MobileApi = {
  collaboration: {
    rooms: {
      access: Query<RoomArgs, RoomAccess | null>;
      scope: Query<RoomArgs, { conversationType: 'dm' | 'channel'; scope: 'personal' | 'workspace' } | null>;
      messages: Query<RoomArgs & PageArgs & { threadRootMessageId?: Id<'conversationMessages'> }, Page<RoomMessageRecord>>;
      message: Query<MessageArgs, RoomMessageRecord | null>;
      activePublicStreams: Query<RoomArgs & { messageIds: Id<'conversationMessages'>[] }, ActivePublicStreamSnapshot[]>;
      state: Query<RoomArgs, RoomState | null>;
      setReaction: Mutation<MessageArgs & { emoji: string; enabled: boolean }, unknown>;
      setPinned: Mutation<MessageArgs & { pinned: boolean }, unknown>;
      setSaved: Mutation<MessageArgs & { saved: boolean }, unknown>;
      setThreadFollow: Mutation<RoomArgs & { threadRootMessageId: Id<'conversationMessages'>; followed: boolean }, unknown>;
      editMessage: Mutation<MessageArgs & { content: string }, unknown>;
      deleteMessage: Mutation<MessageArgs, unknown>;
      updateMyState: Mutation<RoomArgs & { archived?: boolean; markRead?: boolean; markUnread?: boolean; readSequence?: number; notificationLevel?: 'all' | 'mentions' | 'muted' }, unknown>;
      heartbeat: Mutation<RoomArgs & { sessionId: string; status: 'online' | 'away' | 'offline'; typing?: boolean }>;
      addParticipant: Mutation<RoomArgs & { principalId: string }, unknown>;
      removeParticipant: Mutation<RoomArgs & { principalId: string }, unknown>;
    };
    roomList: { list: Query<{ workspaceId: string; kind: 'dm' | 'channel' | 'all'; limit?: number }, { rooms: Array<{ _id: string; title: string; createdAt: number; updatedAt: number; lastModified: number; conversationType: 'dm' | 'channel'; workspaceId: string }>; hasMore: boolean } | null> };
    activity: {
      notifications: Query<{ workspaceId: string }, WorkspaceNotification[] | null>;
      markRead: Mutation<{ workspaceId: string; notificationIds?: string[]; conversationId?: Id<'conversations'> }, number>;
    };
    directory: { workspaces: Query<Record<string, never>, { workspaces: WorkspaceSummary[]; activeWorkspaceId: string; invitations: Array<{ id: string; workspaceId: string; workspaceName: string; role: string; expiresAt: number }> } | null> };
    management: { view: Query<{ workspaceId: string; view: 'people' | 'guests' | 'teams' | 'roles' | 'chats-agents' }, WorkspaceManagementResponse | null> };
  };
  chat: { personal: {
    list: Query<{ workspaceId: string; archived: boolean; scope?: 'personal' | 'workspace' } & PageArgs, Page<PersonalSummary>>;
    getSummary: Query<RoomArgs, PersonalSummary | null>;
    getMessages: Query<RoomArgs & PageArgs, Page<PersonalMessageRow>>;
    activePublicStreams: Query<RoomArgs & { messageIds: Id<'conversationMessages'>[] }, ActivePublicStreamSnapshot[]>;
    create: Mutation<{ workspaceId: string; clientId: string; title: string; scope?: 'personal' | 'workspace' } & Preferences, Id<'conversations'>>;
    rename: Mutation<RoomArgs & { title: string }>;
    setPreferences: Mutation<RoomArgs & Preferences>;
    setRead: Mutation<RoomArgs & { unread: boolean; throughMessageId?: Id<'conversationMessages'> }>;
    setArchived: Mutation<RoomArgs & { archived: boolean }>;
  } };
  search: { browse: { mentions: Query<{ workspaceId: string; query: string }, BrowseMentions | null> } };
}

export const api = anyApi as unknown as MobileApi
