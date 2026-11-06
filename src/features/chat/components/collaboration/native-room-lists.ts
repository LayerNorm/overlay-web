'use client'

import { useMemo } from 'react'
import { useNativeCollaboration, type NativeRoomSummary } from './NativeCollaborationProvider'
import type { Conversation } from '../ChatInlinePanel'

export function roomListRow(row: NativeRoomSummary): Conversation {
  return { _id: row.conversationId, title: row.title, workspaceId: row.workspaceId, scope: 'workspace' as const,
    conversationType: row.kind === 'channel' ? 'channel' as const : 'dm' as const,
    lastModified: row.lastModified, archivedAt: row.archivedAt }
}

type Row = { _id: string; conversationType?: string }
export function withoutRooms<T extends Row>(rows: T[]): T[] {
  return rows.filter(row => row.conversationType !== 'dm' && row.conversationType !== 'channel')
}

export function useNativeRoomLists(view: string, archived = false) {
  const native = useNativeCollaboration()
  const enabled = native.status !== 'disabled' && view !== 'personal'
  const direct = archived ? native.archivedDirect : native.direct
  const channels = archived ? native.archivedChannels : native.channels
  const lists = useMemo(() => view === 'dms' ? [direct] : view === 'channels' ? [channels] : [direct, channels], [channels, direct, view])
  const rows = useMemo(() => enabled ? lists.flatMap(list => list.rows.map(roomListRow)) : [], [enabled, lists])
  return useMemo(() => ({ enabled, rows, exclusive: enabled && (view === 'dms' || view === 'channels'),
    status: native.status, loading: enabled && native.status === 'loading', unavailable: enabled && native.status === 'unavailable',
    hasMore: enabled && lists.some(list => list.hasMore), loadingMore: enabled && lists.some(list => list.loadingMore),
    suppressLegacy(personalView: boolean) { return personalView || (enabled && (view === 'dms' || view === 'channels')) },
    unavailableOr(other: boolean) { return other || (enabled && native.status === 'unavailable') },
    loadMore() { if (enabled) lists.forEach(list => list.loadMore()) },
    merge<T extends Row>(legacy: T[]): Array<T | ReturnType<typeof roomListRow>> {
      return enabled ? [...withoutRooms(legacy), ...rows] : legacy
    },
  }), [enabled, lists, native.status, rows, view])
}

export function roomListSource<T extends {
  chats: Conversation[]; loading: boolean; hasMore: boolean; loadingMore: boolean; loadMoreChats(): Promise<void>
}>(legacy: T, native: ReturnType<typeof useNativeRoomLists>): T {
  if (!native.enabled) return legacy
  return { ...legacy, chats: native.merge(legacy.chats), loading: native.exclusive ? native.loading : legacy.loading || native.loading,
    hasMore: native.hasMore || (!native.exclusive && legacy.hasMore), loadingMore: native.loadingMore || (!native.exclusive && legacy.loadingMore),
    async loadMoreChats() { native.loadMore(); if (!native.exclusive && legacy.hasMore) await legacy.loadMoreChats() } }
}
