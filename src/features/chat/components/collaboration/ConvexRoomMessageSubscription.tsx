'use client'

import { useEffect } from 'react'
import { useMemo } from 'react'
import { usePaginatedQuery, useQuery } from 'convex/react'
import { api } from '../../../../../convex/_generated/api'
import type { Id } from '../../../../../convex/_generated/dataModel'
import type { RoomMessageRecord } from './room-message-view'
import { projectActivePublicStreams } from '@/shared/chat/public-stream-projection'
import { usePublicStreamMetrics } from '@/components/providers/usePublicStreamMetrics'

export type RoomSummary = {
  title: string
  conversationType: 'dm' | 'channel'
  externalPlatform: string | null
}

export type RoomPaging = {
  hasMore: boolean
  loadingMore: boolean
  loadMore: () => void
}

const PAGE_SIZE = 50

/**
 * Owns the room transcript: the live main timeline, the open thread and a permalinked
 * message, read with native Convex identity. Results flow into the room's merge with
 * local optimistic rows. `onRoom` reports undefined while loading and null when the
 * member cannot read the room.
 */
export function ConvexRoomMessageSubscription({
  conversationId,
  threadRootMessageId,
  permalinkMessageId,
  workspaceId,
  onMessages,
  onRoom,
  onPaging,
}: {
  conversationId: string
  threadRootMessageId: string | null
  permalinkMessageId: string | null
  workspaceId: string
  onMessages: (messages: RoomMessageRecord[]) => void
  onRoom: (room: RoomSummary | null | undefined) => void
  onPaging: (paging: RoomPaging) => void
}) {
  const args = { workspaceId, conversationId: conversationId as Id<'conversations'> }
  const room = useQuery(api.collaboration.rooms.access, args)
  const main = usePaginatedQuery(api.collaboration.rooms.messages, room ? args : 'skip', { initialNumItems: PAGE_SIZE })
  const thread = usePaginatedQuery(
    api.collaboration.rooms.messages,
    room && threadRootMessageId
      ? { ...args, threadRootMessageId: threadRootMessageId as Id<'conversationMessages'> }
      : 'skip',
    { initialNumItems: PAGE_SIZE },
  )
  const permalink = useQuery(
    api.collaboration.rooms.message,
    room && permalinkMessageId
      ? { ...args, messageId: permalinkMessageId as Id<'conversationMessages'> }
      : 'skip',
  )
  const loadedMessages = useMemo(() => {
    const seen = new Set<string>()
    return [...main.results, ...thread.results, ...(permalink ? [permalink] : [])].filter(message => {
      if (message.conversationId !== conversationId || message.deletedAt !== undefined || seen.has(message._id)) return false
      seen.add(message._id)
      return true
    })
  }, [conversationId, main.results, permalink, thread.results])
  const activeMessageIds = useMemo(() => {
    const latestMain = [...main.results].sort((a, b) => b.createdAt - a.createdAt)
    const candidates = [...thread.results, ...(permalink ? [permalink] : []), ...latestMain]
    const seen = new Set<string>()
    return candidates.filter(message => {
      if (message.conversationId !== conversationId || message.deletedAt !== undefined
        || message.status !== 'generating' || seen.has(message._id)) return false
      seen.add(message._id)
      return true
    }).slice(0, 50).map(message => message._id)
  }, [conversationId, main.results, permalink, thread.results])
  const activeStreams = useQuery(api.collaboration.rooms.activePublicStreams,
    room ? {
      ...args,
      messageIds: activeMessageIds,
    } : 'skip')
  usePublicStreamMetrics(activeStreams ?? [])
  const projectedMessages = useMemo(
    () => projectActivePublicStreams(loadedMessages, activeStreams ?? []) as RoomMessageRecord[],
    [activeStreams, loadedMessages],
  )

  useEffect(() => { onRoom(room) }, [onRoom, room])

  useEffect(() => {
    if (!room || main.status === 'LoadingFirstPage') return
    // react-doctor-disable-next-line react-doctor/no-pass-data-to-parent
    onMessages(projectedMessages)
  }, [main.status, onMessages, projectedMessages, room, conversationId])

  const { status, loadMore } = main
  useEffect(() => {
    onPaging({
      hasMore: status === 'CanLoadMore',
      loadingMore: status === 'LoadingMore',
      loadMore: () => loadMore(100),
    })
  }, [loadMore, onPaging, status])

  return null
}
