'use client'

import { useMemo } from 'react'
import { Button } from '@overlay/ui/primitives'
import { useNativeCollaboration } from '@/components/providers/native-collaboration-context'
import type { ArchivedItem } from './archived-items'
import { useNativeRoomStateClient } from '@/components/providers/native-room-state-client'

export function useNativeArchivedRoomItems() {
  const native = useNativeCollaboration()
  const client = useNativeRoomStateClient()
  return useMemo(() => {
    const enabled = native.status !== 'disabled'
    const items: ArchivedItem[] = enabled ? [...native.archivedDirect.rows, ...native.archivedChannels.rows].map(row => ({
      key: `chat:${row.conversationId}`, kind: 'chat', category: 'chats', id: row.conversationId, name: row.title,
      scope: 'workspace', archivedAt: row.archivedAt, conversationType: row.kind === 'channel' ? 'channel' : 'dm',
      workspaceId: row.workspaceId, href: `/app/archived?id=${encodeURIComponent(row.conversationId)}`,
    })) : []
    return { items, isRoom(item: ArchivedItem) { return enabled && item.kind === 'chat' && (item.conversationType === 'dm' || item.conversationType === 'channel') },
      async restore(item: ArchivedItem) { await client.act(item.id, { kind: 'setRoomArchived', archived: false, scope: 'self' }) }, filterLegacy(rows: ArchivedItem[]) {
      return enabled ? rows.filter(row => row.kind !== 'chat' || (row.conversationType !== 'dm' && row.conversationType !== 'channel')) : rows
    }, reportFailures(failed: string[]) {
      return native.status === 'unavailable' && !failed.includes('chats') ? [...failed, 'chats'] : failed
    } }
  }, [client, native])
}

export function NativeArchivedRoomsMore() {
  const native = useNativeCollaboration()
  const lists = [native.archivedDirect, native.archivedChannels]
  if (native.status === 'disabled' || !lists.some(list => list.hasMore)) return null
  return <Button variant="ghost" disabled={lists.some(list => list.loadingMore)} onClick={() => lists.forEach(list => list.loadMore())}>Load more archived rooms</Button>
}
