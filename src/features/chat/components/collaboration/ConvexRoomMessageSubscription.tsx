'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { usePaginatedQuery, useQuery } from 'convex/react'
import { api } from '../../../../../convex/_generated/api'
import type { Id } from '../../../../../convex/_generated/dataModel'
import type { RoomMessageRecord } from './room-message-view'
import { projectActivePublicStreams } from '@/shared/chat/public-stream-projection'
import { useLivePublicStreams } from '@/components/providers/useLivePublicStreams'
import { restoredPageSize } from '@/shared/chat/transcript-cache'
import {
  transcriptCache,
  useTranscriptCacheKey,
  type RoomCachedAccess,
  type RoomCachedMessage,
} from '@/components/providers/transcript-cache-client'

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
  const cacheKey = useTranscriptCacheKey({ kind: 'room', conversationId }, workspaceId)
  // The live first page asks for as many rows as the restored snapshot showed, so replacing it does not shift the reader.
  const [initialNumItems] = useState(() => restoredPageSize(cacheKey ? transcriptCache.get(cacheKey) : null, PAGE_SIZE))
  const main = usePaginatedQuery(api.collaboration.rooms.messages, room ? args : 'skip', { initialNumItems })
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
      // Deleted rows stay: the room renders them as tombstones.
      if ((message.conversationId && message.conversationId !== conversationId) || seen.has(message.id)) return false
      seen.add(message.id)
      return true
    })
  }, [conversationId, main.results, permalink, thread.results])
  const activeMessageIds = useMemo(() => {
    const latestMain = [...main.results].sort((a, b) => b.createdAt - a.createdAt)
    const candidates = [...thread.results, ...(permalink ? [permalink] : []), ...latestMain]
    const seen = new Set<string>()
    return candidates.filter(message => {
      if ((message.conversationId && message.conversationId !== conversationId) || message.deletedAt !== undefined
        || message.status !== 'generating' || seen.has(message.id)) return false
      seen.add(message.id)
      return true
    }).slice(0, 50).map(message => message.id as Id<'conversationMessages'>)
  }, [conversationId, main.results, permalink, thread.results])
  // Only subscribe while something is generating: idle rooms never depend on the stream query.
  const settings = useQuery(api.platform.uiSettings.mine, {})
  const activeStreams = useLivePublicStreams({
    scope: room ? { workspaceId, conversationId } : null,
    messageIds: activeMessageIds,
    incremental: settings?.livePublicStreamRevision === 'incremental-v1',
    fullQuery: api.collaboration.rooms.activePublicStreams,
    updatesQuery: api.collaboration.rooms.activePublicStreamUpdates,
  })
  const projectedMessages = useMemo(
    () => projectActivePublicStreams(loadedMessages, activeStreams) as RoomMessageRecord[],
    [activeStreams, loadedMessages],
  )

  useEffect(() => { onRoom(room) }, [onRoom, room])

  const snapshotRef = useRef<{ key: string; items: RoomCachedMessage[]; access: RoomCachedAccess; isDone: boolean } | null>(null)
  useEffect(() => {
    if (!cacheKey) return
    if (room === null) {
      transcriptCache.evict(cacheKey)
      snapshotRef.current = null
    } else if (room && main.status !== 'LoadingFirstPage') {
      snapshotRef.current = { key: cacheKey, items: main.results, access: room, isDone: main.status === 'Exhausted' }
    }
  }, [cacheKey, main.results, main.status, room])
  // Write back when the reader leaves, not on every streamed update.
  useEffect(() => () => {
    const snapshot = snapshotRef.current
    snapshotRef.current = null
    if (snapshot?.key !== cacheKey) return
    transcriptCache.put<RoomCachedMessage, RoomCachedAccess>(snapshot.key, {
      items: snapshot.items, summary: snapshot.access, isDone: snapshot.isDone, source: 'live',
    })
  }, [cacheKey])

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
