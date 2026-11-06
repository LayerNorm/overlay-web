'use client'

import { useQuery } from 'convex/react'
import type { ReactNode } from 'react'
import { Button } from '@overlay/ui/primitives'
import type { Id } from '../../../../../convex/_generated/dataModel'
import { api } from '../../../../../convex/_generated/api'
import { DirectMessageExperience } from '../DirectMessageExperience'
import { useNativeCollaboration } from './NativeCollaborationProvider'
import { useNativeRoomLists } from './native-room-lists'

export function NativeArchivedRoomEntry({ conversationId, personalFallback }: { conversationId: string; personalFallback?: ReactNode }) {
  const native = useNativeCollaboration()
  const room = useQuery(api.collaboration.nativeRooms.getRoom, native.status === 'ready' && native.workspaceId
    ? { workspaceId: native.workspaceId, conversationId: conversationId as Id<'conversations'> } : 'skip')
  if (native.status === 'unavailable') return <div role="status">This archived conversation is unavailable.</div>
  if (native.status === 'loading' || room === undefined) return <div role="status">Loading archived conversation…</div>
  if (room === null && personalFallback) return personalFallback
  if (!room || room.conversationId !== conversationId || room.archivedAt === undefined || room.workspaceId !== native.workspaceId || room.viewerUserId !== native.viewerUserId) {
    return <div role="status">This archived conversation is unavailable.</div>
  }
  return <DirectMessageExperience conversationId={conversationId} conversationType={room.kind === 'channel' ? 'channel' : 'dm'} />
}

export function ArchivedRoomLoadMore() {
  const rooms = useNativeRoomLists('all', true)
  if (!rooms.hasMore) return null
  return <Button size="sm" disabled={rooms.loadingMore} onClick={rooms.loadMore}>Load more archived rooms</Button>
}
