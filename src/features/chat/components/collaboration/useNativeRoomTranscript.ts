'use client'

import { usePaginatedQuery, useQuery } from 'convex/react'
import type { FunctionArgs, FunctionReference, FunctionReturnType } from 'convex/server'
import { api } from '../../../../../convex/_generated/api'
import type { Id } from '../../../../../convex/_generated/dataModel'
import { mergeRoomMessages, type RoomMessageRecord } from './room-message-view'
import { useNativeCollaboration, type NativeCollaborationStatus } from './NativeCollaborationProvider'

type Message = NonNullable<FunctionReturnType<typeof api.collaboration.nativeRooms.listMessages>>['page'][number]
type MessagesQuery = typeof api.collaboration.nativeRooms.listMessages
type Room = FunctionReturnType<typeof api.collaboration.nativeRooms.getRoom>

function roomInScope(room: Room | undefined, workspaceId: string, conversationId: string, viewerUserId: string | null) {
  return Boolean(room && room.conversationId === conversationId && room.workspaceId === workspaceId && room.viewerUserId === viewerUserId)
}

function transcriptStatus(enabled: boolean, status: NativeCollaborationStatus, room: Room | undefined, authorized: boolean, loading: boolean): NativeCollaborationStatus {
  if (!enabled) return 'disabled'
  if (status !== 'ready') return status
  if (room === null) return 'unavailable'
  return !authorized || loading ? 'loading' : 'ready'
}
// A raced null page throws in pagination and is caught by the native error boundary.
const paginatedMessages = api.collaboration.nativeRooms.listMessages as FunctionReference<
  'query', 'public', FunctionArgs<MessagesQuery>, NonNullable<FunctionReturnType<MessagesQuery>>
>

export function nativeRoomMessage(row: Message): RoomMessageRecord {
  return { ...row, authorKind: row.authorKind ?? (row.role === 'assistant' ? 'model' : 'human'),
    parts: JSON.parse(row.partsJson), agentPlan: JSON.parse(row.agentPlanJson) }
}

export function useNativeRoomTranscript({ workspaceId, conversationId, threadRootMessageId, anchorMessageId, enabled = true }: {
  workspaceId: string; conversationId: string; threadRootMessageId?: string; anchorMessageId?: string
  enabled?: boolean
}) {
  const native = useNativeCollaboration()
  const canQuery = enabled && native.status === 'ready' && native.workspaceId === workspaceId
  const args = { workspaceId, conversationId: conversationId as Id<'conversations'> }
  const room = useQuery(api.collaboration.nativeRooms.getRoom, canQuery ? args : 'skip')
  const authorized = canQuery && roomInScope(room, workspaceId, conversationId, native.viewerUserId)
  const page = usePaginatedQuery(paginatedMessages, authorized
    ? { ...args, threadRootMessageId: threadRootMessageId as Id<'conversationMessages'> | undefined } : 'skip', { initialNumItems: 50 })
  const anchor = useQuery(api.collaboration.nativeRooms.getMessageAnchor, authorized && anchorMessageId
    ? { ...args, messageId: anchorMessageId as Id<'conversationMessages'> } : 'skip')
  const inStream = (row: Pick<Message, 'conversationId' | 'threadRootMessageId'>) => row.conversationId === conversationId
    && row.threadRootMessageId === threadRootMessageId
  const canonical = authorized ? page.results.filter(inStream).map(nativeRoomMessage) : []
  if (authorized && anchor?.message.conversationId === conversationId && anchor.message.id === anchorMessageId) {
    canonical.push(nativeRoomMessage(anchor.message))
  }
  const rows = authorized ? mergeRoomMessages(canonical, []) : []
  const status = transcriptStatus(enabled, native.status, room, authorized, page.status === 'LoadingFirstPage')
  return { room: authorized ? room : null, rows, status, scopeKey: JSON.stringify([native.scopeKey, workspaceId, conversationId, threadRootMessageId, anchorMessageId]),
    hasMore: authorized && page.status === 'CanLoadMore', loadingMore: authorized && page.status === 'LoadingMore',
    loadMore() { if (authorized && page.status === 'CanLoadMore') page.loadMore(50) } }
}
