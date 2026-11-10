import type {
  ChannelCreateInput, ChannelSummary, ConversationParticipantStateInput,
  DirectMessageSummary, WorkspaceNotification, WorkspaceNotificationFilter,
  WorkspaceNotificationPreferences, WorkspaceManagementResponse,
} from '@overlay/workspace-contracts'
import type { FunctionReturnType } from 'convex/server'
import { mobileOverlayAppClient } from './overlayClient'
import { api, convexWorkspaceId, mutateConvex, queryConvex, subscribeConvex, type Id } from './convexClient'
import type { RoomMessageRecord } from '../lib/roomMessages'
import { projectActivePublicStreams, type ActivePublicStreamSnapshot } from '../../src/shared/chat/public-stream-projection'

export const COLLABORATION_NATIVE_READY = true
export type NativeRoomState = NonNullable<FunctionReturnType<typeof api.collaboration.rooms.state>>

function roomArgs(conversationId: string) {
  return { workspaceId: convexWorkspaceId(), conversationId: conversationId as Id<'conversations'> }
}
function messageArgs(conversationId: string, messageId: string) {
  return { ...roomArgs(conversationId), messageId: messageId as Id<'conversationMessages'> }
}

export interface RoomTranscriptPage {
  title?: string
  conversationType?: 'personal' | 'dm' | 'channel'
  messages: RoomMessageRecord[]
  hasMore: boolean
  cursor?: string
}
type TranscriptOptions = { threadRootMessageId?: string; mainOnly?: boolean; beforeCreatedAt?: number; messageId?: string; limit?: number; cursor?: string }

function transcriptArgs(conversationId: string, options: TranscriptOptions) {
  return {
    ...roomArgs(conversationId),
    ...(options.threadRootMessageId ? { threadRootMessageId: options.threadRootMessageId as Id<'conversationMessages'> } : {}),
    paginationOpts: { numItems: Math.min(options.limit ?? 100, 100), cursor: options.cursor ?? null },
  }
}

export async function loadRoomMessages(conversationId: string, options: TranscriptOptions = {}): Promise<RoomTranscriptPage> {
  const args = roomArgs(conversationId)
  const access = await queryConvex(api.collaboration.rooms.access, args)
  if (!access) return { messages: [], hasMore: false }
  const [page, root] = await Promise.all([
    queryConvex(api.collaboration.rooms.messages, transcriptArgs(conversationId, options)),
    options.messageId || options.threadRootMessageId
      ? queryConvex(api.collaboration.rooms.message, messageArgs(conversationId, options.messageId ?? options.threadRootMessageId!))
      : null,
  ])
  return { ...access, messages: [...page.page, ...(root ? [root] : [])], hasMore: !page.isDone, cursor: page.continueCursor }
}

export function subscribeRoomState(conversationId: string, onValue: (state: NativeRoomState | null) => void) {
  return subscribeConvex(api.collaboration.rooms.state, roomArgs(conversationId), onValue)
}

export function subscribeRoomMessages(conversationId: string, options: TranscriptOptions, onValue: (page: RoomTranscriptPage) => void) {
  const stops: Array<() => void> = []
  let access: FunctionReturnType<typeof api.collaboration.rooms.access> | undefined
  let messages: RoomMessageRecord[] = []
  let root: RoomMessageRecord | null = null
  let hasMore = false
  let pageReady = false
  let cursor: string | undefined
  let streams: ActivePublicStreamSnapshot[] = []
  let stopStreams: (() => void) | undefined
  let streamKey = ''
  const emit = () => {
    if (access === undefined || (access && !pageReady)) return
    onValue({ ...(access ?? {}), messages: access ? projectActivePublicStreams([...messages, ...(root ? [root] : [])], streams) : [], hasMore: Boolean(access) && hasMore, cursor })
  }
  stops.push(subscribeConvex(api.collaboration.rooms.access, roomArgs(conversationId), value => { access = value; emit() }))
  stops.push(subscribeConvex(api.collaboration.rooms.scope, roomArgs(conversationId), value => { if (!value) { access = null; emit() } }))
  stops.push(subscribeConvex(api.collaboration.rooms.messages, transcriptArgs(conversationId, options), value => {
    messages = value.page
    pageReady = true
    hasMore = !value.isDone
    cursor = value.continueCursor
    const messageIds = messages.filter(row => row.status === 'generating').slice(0, 50).map(row => row.id as Id<'conversationMessages'>)
    const key = messageIds.join(',')
    if (key !== streamKey) {
      stopStreams?.(); streams = []; streamKey = key
      stopStreams = messageIds.length ? subscribeConvex(api.collaboration.rooms.activePublicStreams, { ...roomArgs(conversationId), messageIds }, value => { streams = value; emit() }) : undefined
    }
    emit()
  }))
  if (options.threadRootMessageId) stops.push(subscribeConvex(api.collaboration.rooms.message, messageArgs(conversationId, options.threadRootMessageId), value => { root = value; emit() }))
  return () => { stops.forEach(stop => stop()); stopStreams?.() }
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


export async function editRoomMessage(conversationId: string, messageId: string, content: string): Promise<void> {
  await mutateConvex(api.collaboration.rooms.editMessage, { ...messageArgs(conversationId, messageId), content })
}
export async function deleteRoomMessage(conversationId: string, messageId: string): Promise<void> {
  await mutateConvex(api.collaboration.rooms.deleteMessage, messageArgs(conversationId, messageId))
}
async function roomState(conversationId: string) {
  return queryConvex(api.collaboration.rooms.state, roomArgs(conversationId))
}
export async function fetchRoomParticipants(conversationId: string) {
  const state = await roomState(conversationId)
  return { participants: state?.participants ?? [], currentPrincipalId: state?.currentPrincipalId ?? '' }
}
export async function addRoomParticipant(conversationId: string, principalId: string): Promise<void> {
  await mutateConvex(api.collaboration.rooms.addParticipant, { ...roomArgs(conversationId), principalId })
}
export async function removeRoomParticipant(conversationId: string, principalId: string): Promise<void> {
  await mutateConvex(api.collaboration.rooms.removeParticipant, { ...roomArgs(conversationId), principalId })
}
export async function updateRoomParticipantState(conversationId: string, state: ConversationParticipantStateInput): Promise<void> {
  await mutateConvex(api.collaboration.rooms.updateMyState, {
    ...roomArgs(conversationId),
    archived: state.archived, markRead: state.markRead, markUnread: state.markUnread,
    notificationLevel: state.notificationLevel,
  })
}
export async function fetchRoomPresence(conversationId: string) { return (await roomState(conversationId))?.presence ?? [] }
export async function sendRoomPresence(conversationId: string, body: { status: 'online' | 'away' | 'offline'; sessionId?: string; typing?: boolean }): Promise<void> {
  await mutateConvex(api.collaboration.rooms.heartbeat, { ...roomArgs(conversationId), ...body, sessionId: body.sessionId ?? 'mobile' })
}
export async function fetchRoomReactions(conversationId: string) { return (await roomState(conversationId))?.reactions ?? [] }
export async function setRoomReaction(conversationId: string, messageId: string, emoji: string, enabled: boolean) {
  await mutateConvex(api.collaboration.rooms.setReaction, { ...messageArgs(conversationId, messageId), emoji, enabled })
  return fetchRoomReactions(conversationId)
}
export async function fetchRoomPins(conversationId: string) { return (await roomState(conversationId))?.pins ?? [] }
export async function setRoomPinned(conversationId: string, messageId: string, pinned: boolean): Promise<void> {
  await mutateConvex(api.collaboration.rooms.setPinned, { ...messageArgs(conversationId, messageId), pinned })
}
export async function fetchSavedMessages(conversationId: string) { return (await roomState(conversationId))?.saved ?? [] }
export async function setMessageSaved(conversationId: string, messageId: string, saved: boolean): Promise<void> {
  await mutateConvex(api.collaboration.rooms.setSaved, { ...messageArgs(conversationId, messageId), saved })
}
export async function reportRoomMessage(
  conversationId: string,
  body: { messageId?: string; reason: string; note?: string },
): Promise<void> {
  await mobileOverlayAppClient.conversations.reportMessage(conversationId, body)
}


export async function fetchThreadFollow(conversationId: string, threadRootMessageId: string) {
  const follows = (await roomState(conversationId))?.follows ?? []
  return { following: follows.some(row => row.threadRootMessageId === threadRootMessageId), follows }
}
export async function setThreadFollowed(conversationId: string, threadRootMessageId: string, followed: boolean): Promise<void> {
  await mutateConvex(api.collaboration.rooms.setThreadFollow, { ...roomArgs(conversationId), threadRootMessageId: threadRootMessageId as Id<'conversationMessages'>, followed })
}
export async function listChannels() {
  const result = await queryConvex(api.collaboration.roomList.list, { workspaceId: convexWorkspaceId(), kind: 'channel', limit: 100 })
  return result?.rooms ?? []
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


export interface RoomPrincipalOption {
  principalId: string
  principalType: 'human' | 'agent'
  name: string
  description?: string
}
export async function searchWorkspacePrincipals(workspaceId: string): Promise<{ options: RoomPrincipalOption[]; currentPrincipalId: string }> {
  const [people, agents] = await Promise.all([
    queryConvex(api.collaboration.management.view, { workspaceId, view: 'people' }),
    queryConvex(api.collaboration.management.view, { workspaceId, view: 'chats-agents' }),
  ])
  const items = [...(people?.items ?? []), ...(agents?.items ?? [])]
  const options = new Map<string, RoomPrincipalOption>()
  for (const item of items) {
    if (item.kind !== 'member' || !item.principalId || item.status !== 'active' || item.principalId === people?.currentPrincipalId) continue
    options.set(item.principalId, { principalId: item.principalId, principalType: item.principalType === 'agent' ? 'agent' : 'human', name: item.name, description: item.description })
  }
  return { options: [...options.values()], currentPrincipalId: people?.currentPrincipalId ?? '' }
}

export function filterNotifications(items: WorkspaceNotification[], filter: WorkspaceNotificationFilter, options: { unreadOnly?: boolean; limit?: number } = {}) {
  return items.filter(item => {
    if ((options.unreadOnly || filter === 'unread') && item.readAt) return false
    if (filter === 'mentions') return item.type === 'mention'
    if (filter === 'threads') return item.type === 'thread'
    if (filter === 'reactions') return item.type === 'reaction'
    return true
  }).slice(0, options.limit ?? 100)
}
export async function fetchNotifications(filter: WorkspaceNotificationFilter = 'all', options: { unreadOnly?: boolean; limit?: number } = {}): Promise<WorkspaceNotification[]> {
  const items = await queryConvex(api.collaboration.activity.notifications, { workspaceId: convexWorkspaceId() })
  return filterNotifications(items ?? [], filter, options)
}
export function subscribeNotifications(onValue: (items: WorkspaceNotification[]) => void) {
  return subscribeConvex(api.collaboration.activity.notifications, { workspaceId: convexWorkspaceId() }, items => onValue(items ?? []))
}
export async function markNotificationsRead(notificationIds: string[]): Promise<void> {
  if (!notificationIds.length) return
  await mutateConvex(api.collaboration.activity.markRead, { workspaceId: convexWorkspaceId(), notificationIds })
}
export async function markConversationNotificationsRead(conversationId: string): Promise<void> {
  await mutateConvex(api.collaboration.activity.markRead, roomArgs(conversationId))
}

// Convex has no member-facing preferences function yet; keep these controls hidden.
export async function fetchNotificationPreferences(): Promise<WorkspaceNotificationPreferences> {
  throw new Error('Notification preferences are not available on mobile yet.')
}
export async function updateNotificationPreferences(_preferences: Partial<WorkspaceNotificationPreferences>): Promise<WorkspaceNotificationPreferences> {
  throw new Error('Notification preferences are not available on mobile yet.')
}
export type { WorkspaceManagementResponse }
