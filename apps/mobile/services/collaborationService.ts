/**
 * Collaboration service facade — wraps the typed `mobileOverlayAppClient`
 * conversations surface for multiplayer chat: rooms (DMs/channels),
 * participants, presence, reactions, pins, saved messages, threads,
 * notifications, and notification preferences.
 *
 * Every call flows through `appFetch`, so the active workspace header from
 * Phase 0 applies automatically. Workspace-scoped creates use the explicit
 * `createWorkspace*` variants like the web client does.
 */
import type {
  ChannelCreateInput,
  ChannelSummary,
  ConversationParticipant,
  ConversationParticipantStateInput,
  ConversationPin,
  ConversationPresence,
  ConversationSavedMessage,
  ConversationThreadFollow,
  DirectMessageSummary,
  MessageReaction,
  WorkspaceManagementItem,
  WorkspaceManagementResponse,
  WorkspaceNotification,
  WorkspaceNotificationFilter,
  WorkspaceNotificationPreferences,
} from '@overlay/workspace-contracts'
import { appJson } from './appApi'
import { mobileOverlayAppClient } from './overlayClient'
import type { RoomMessageRecord } from '../lib/roomMessages'

// ---------------------------------------------------------------------------
// Room transcript — `GET /conversations?conversationId&messages` with the
// collaboration query flags web uses (mainOnly/threadRootMessageId/before).
// ---------------------------------------------------------------------------

export interface RoomTranscriptPage {
  title?: string
  conversationType?: 'personal' | 'dm' | 'channel'
  messages: RoomMessageRecord[]
  hasMore: boolean
}

export async function loadRoomMessages(
  conversationId: string,
  options: {
    threadRootMessageId?: string
    mainOnly?: boolean
    beforeCreatedAt?: number
    messageId?: string
    limit?: number
  } = {},
): Promise<RoomTranscriptPage> {
  const data = await appJson<{
    title?: string
    conversationType?: 'personal' | 'dm' | 'channel'
    messages?: Array<RoomMessageRecord & { content?: string; parts?: Array<{ type?: string; text?: string }> }>
    hasMore?: boolean
  }>('/api/v1/conversations', {
    query: {
      conversationId,
      messages: true,
      limit: options.limit ?? 100,
      ...(options.threadRootMessageId ? { threadRootMessageId: options.threadRootMessageId } : {}),
      ...(options.mainOnly ? { mainOnly: true } : {}),
      ...(options.beforeCreatedAt ? { beforeCreatedAt: options.beforeCreatedAt } : {}),
      ...(options.messageId ? { messageId: options.messageId } : {}),
    },
  })
  const messages = (data.messages ?? []).map((message) => ({
    ...message,
    content:
      message.content ??
      message.parts?.find((part) => part.type === 'text')?.text ??
      '',
    turnId: message.turnId ?? message.id,
  }))
  return {
    title: data.title,
    conversationType: data.conversationType,
    messages,
    hasMore: data.hasMore === true,
  }
}

export async function sendRoomMessage(input: {
  conversationId: string
  turnId: string
  content: string
  clientNonce: string
  mentionedPrincipalIds: string[]
  memoryEnabled: boolean
  threadRootMessageId?: string
  parts?: Array<Record<string, unknown>>
  attachmentNames?: string[]
  replyToTurnId?: string
  replySnippet?: string
}): Promise<void> {
  await mobileOverlayAppClient.conversations.addMessage({
    conversationId: input.conversationId,
    turnId: input.turnId,
    role: 'user',
    mode: 'act',
    content: input.content,
    contentType: 'text',
    clientNonce: input.clientNonce,
    mentionedPrincipalIds: input.mentionedPrincipalIds,
    memoryEnabled: input.memoryEnabled,
    threadRootMessageId: input.threadRootMessageId,
    ...(input.parts?.length ? { parts: input.parts } : {}),
    ...(input.attachmentNames?.length ? { attachmentNames: input.attachmentNames } : {}),
    ...(input.replyToTurnId
      ? { replyToTurnId: input.replyToTurnId, replySnippet: input.replySnippet ?? '' }
      : {}),
  })
}

// ---------------------------------------------------------------------------
// Collaborative message edits — PATCH/DELETE the message row directly.
// ---------------------------------------------------------------------------

export async function editRoomMessage(
  conversationId: string,
  messageId: string,
  content: string,
): Promise<void> {
  await mobileOverlayAppClient.conversations.editCollaborativeMessage(conversationId, messageId, content)
}

export async function deleteRoomMessage(conversationId: string, messageId: string): Promise<void> {
  await mobileOverlayAppClient.conversations.deleteCollaborativeMessage(conversationId, messageId)
}

// ---------------------------------------------------------------------------
// Participants + presence
// ---------------------------------------------------------------------------

export async function fetchRoomParticipants(
  conversationId: string,
): Promise<{ participants: ConversationParticipant[]; currentPrincipalId: string }> {
  return mobileOverlayAppClient.conversations.participants(conversationId)
}

export async function addRoomParticipant(
  conversationId: string,
  principalId: string,
): Promise<void> {
  await mobileOverlayAppClient.conversations.addParticipant(conversationId, principalId)
}

export async function removeRoomParticipant(
  conversationId: string,
  principalId: string,
): Promise<void> {
  await mobileOverlayAppClient.conversations.removeParticipant(conversationId, principalId)
}

export async function updateRoomParticipantState(
  conversationId: string,
  state: ConversationParticipantStateInput,
): Promise<void> {
  await mobileOverlayAppClient.conversations.updateParticipantState(conversationId, state)
}

export async function fetchRoomPresence(conversationId: string): Promise<ConversationPresence[]> {
  const { presence } = await mobileOverlayAppClient.conversations.presence(conversationId)
  return presence
}

export async function sendRoomPresence(
  conversationId: string,
  body: { status: 'online' | 'away' | 'offline'; sessionId?: string; typing?: boolean },
): Promise<void> {
  await mobileOverlayAppClient.conversations.updatePresence(conversationId, body)
}

// ---------------------------------------------------------------------------
// Reactions / pins / saved
// ---------------------------------------------------------------------------

export async function fetchRoomReactions(conversationId: string): Promise<MessageReaction[]> {
  const { reactions } = await mobileOverlayAppClient.conversations.reactions(conversationId)
  return reactions
}

export async function setRoomReaction(
  conversationId: string,
  messageId: string,
  emoji: string,
  enabled: boolean,
): Promise<MessageReaction[]> {
  const { reactions } = await mobileOverlayAppClient.conversations.setReaction(conversationId, {
    messageId,
    emoji,
    enabled,
  })
  return reactions
}

export async function fetchRoomPins(conversationId: string): Promise<ConversationPin[]> {
  const { pins } = await mobileOverlayAppClient.conversations.pins(conversationId)
  return pins
}

export async function setRoomPinned(
  conversationId: string,
  messageId: string,
  pinned: boolean,
): Promise<void> {
  await mobileOverlayAppClient.conversations.setPinned(conversationId, { messageId, pinned })
}

export async function fetchSavedMessages(): Promise<ConversationSavedMessage[]> {
  const { savedMessages } = await mobileOverlayAppClient.conversations.savedMessages()
  return savedMessages
}

export async function setMessageSaved(
  conversationId: string,
  messageId: string,
  saved: boolean,
): Promise<void> {
  await mobileOverlayAppClient.conversations.setSaved({ conversationId, messageId, saved })
}

export async function reportRoomMessage(
  conversationId: string,
  body: { messageId?: string; reason: string; note?: string },
): Promise<void> {
  await mobileOverlayAppClient.conversations.reportMessage(conversationId, body)
}

// ---------------------------------------------------------------------------
// Threads
// ---------------------------------------------------------------------------

export async function fetchThreadFollow(
  conversationId: string,
  threadRootMessageId: string,
): Promise<{ following: boolean; follows: ConversationThreadFollow[] }> {
  return mobileOverlayAppClient.conversations.threadFollow(conversationId, threadRootMessageId)
}

export async function setThreadFollowed(
  conversationId: string,
  threadRootMessageId: string,
  followed: boolean,
): Promise<void> {
  await mobileOverlayAppClient.conversations.setThreadFollow(conversationId, threadRootMessageId, followed)
}

// ---------------------------------------------------------------------------
// Channels + direct messages
// ---------------------------------------------------------------------------

export async function listChannels(): Promise<ChannelSummary[]> {
  const { channels } = await mobileOverlayAppClient.conversations.channels()
  return channels
}

export async function createChannel(
  workspaceId: string,
  body: ChannelCreateInput,
): Promise<ChannelSummary | undefined> {
  const { channel, error } = workspaceId
    ? await mobileOverlayAppClient.conversations.createWorkspaceChannel(workspaceId, body)
    : await mobileOverlayAppClient.conversations.createChannel(body)
  if (!channel) throw new Error(error || 'Could not create the channel.')
  return channel
}

export async function createDirectMessage(
  workspaceId: string,
  input: { principalIds: string[]; title?: string; sourceConversationId?: string },
): Promise<DirectMessageSummary> {
  const { directMessage, error } = workspaceId
    ? await mobileOverlayAppClient.conversations.createWorkspaceDirectMessage(workspaceId, input)
    : await mobileOverlayAppClient.conversations.createDirectMessage(input)
  if (!directMessage) throw new Error(error || 'Could not create the message.')
  return directMessage
}

// ---------------------------------------------------------------------------
// Workspace principal search — `management('people')` + `management('chats-agents')`
// merged like the web NewDirectMessageDialog.
// ---------------------------------------------------------------------------

export interface RoomPrincipalOption {
  principalId: string
  principalType: 'human' | 'agent'
  name: string
  description?: string
}

export async function searchWorkspacePrincipals(
  workspaceId: string,
): Promise<{ options: RoomPrincipalOption[]; currentPrincipalId: string }> {
  const [people, agents] = await Promise.all([
    mobileOverlayAppClient.workspaces.management(workspaceId, 'people'),
    mobileOverlayAppClient.workspaces.management(workspaceId, 'chats-agents'),
  ])
  const byId = new Map<string, WorkspaceManagementItem>()
  for (const item of [...people.items, ...agents.items]) {
    if (item.kind === 'member' && item.principalId) byId.set(item.principalId, item)
  }
  const options = [...byId.values()]
    .filter((item) => item.status === 'active' && item.principalId !== people.currentPrincipalId)
    .map((item) => ({
      principalId: item.principalId!,
      principalType: item.principalType === 'agent' ? 'agent' as const : 'human' as const,
      name: item.name,
      description: item.description,
    }))
  return { options, currentPrincipalId: people.currentPrincipalId }
}

// ---------------------------------------------------------------------------
// Notifications — activity feed + unread badges.
// ---------------------------------------------------------------------------

export async function fetchNotifications(
  filter: WorkspaceNotificationFilter = 'all',
  options: { unreadOnly?: boolean; limit?: number } = {},
): Promise<WorkspaceNotification[]> {
  const { notifications } = await mobileOverlayAppClient.conversations.notifications({
    filter,
    unreadOnly: options.unreadOnly,
    limit: options.limit ?? 100,
  })
  return notifications
}

export async function markNotificationsRead(notificationIds: string[]): Promise<void> {
  if (notificationIds.length === 0) return
  await mobileOverlayAppClient.conversations.markNotificationsRead(notificationIds)
}

export async function markConversationNotificationsRead(conversationId: string): Promise<void> {
  await mobileOverlayAppClient.conversations.markConversationNotificationsRead(conversationId)
}

// Notification preferences — no typed client surface yet; same BFF route.
export async function fetchNotificationPreferences(): Promise<WorkspaceNotificationPreferences> {
  const data = await appJson<{ preferences: WorkspaceNotificationPreferences }>(
    '/api/v1/conversations/notification-preferences',
  )
  return data.preferences
}

export async function updateNotificationPreferences(
  preferences: Partial<WorkspaceNotificationPreferences>,
): Promise<WorkspaceNotificationPreferences> {
  const data = await appJson<{ preferences: WorkspaceNotificationPreferences }>(
    '/api/v1/conversations/notification-preferences',
    { method: 'PATCH', json: preferences },
  )
  return data.preferences
}

export type { WorkspaceManagementResponse }
