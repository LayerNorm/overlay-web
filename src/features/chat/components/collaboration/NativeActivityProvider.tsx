'use client'

import { useCallback, useMemo, useState, type ReactNode } from 'react'
import { useMutation, usePaginatedQuery, useQueries, useQuery } from 'convex/react'
import { api } from '../../../../../convex/_generated/api'
import type { Id } from '../../../../../convex/_generated/dataModel'
import { NativeActivityContext, type NativeActivity, type ReadAction } from '@/components/providers/native-activity-context'
import { useNativeCollaboration } from './NativeCollaborationProvider'
import { overlayReadItems, overlayUnreadCounts } from './native-activity-overlays'

type Intent = Omit<Extract<ReadAction, { kind: 'ids' }>, 'id' | 'at'> | Omit<Extract<ReadAction, { kind: 'all' }>, 'id' | 'at'> | Omit<Extract<ReadAction, { kind: 'room' }>, 'id' | 'at'>

function NativeActivityOwner({ children }: { children: ReactNode }) {
  const native = useNativeCollaboration()
  const workspaceId = native.workspaceId ?? ''
  const args = native.status === 'ready' ? { workspaceId } : 'skip'
  const page = usePaginatedQuery(api.collaboration.nativeActivity.listNotifications, args === 'skip' ? args : { ...args, filter: 'all' }, { initialNumItems: 100 })
  const rawCounts = useQuery(api.collaboration.nativeActivity.getUnreadCounts, args)
  const roomQueries = useMemo(() => {
    const queries: Record<string, { query: typeof api.collaboration.nativeActivity.getRoomUnreadCounts; args: { workspaceId: string; conversationIds: Id<'conversations'>[] } }> = {}
    if (native.status !== 'ready') return queries
    const ids = [...new Set([...native.direct.rows, ...native.channels.rows].map(row => row.conversationId))]
    for (let i = 0; i < ids.length; i += 100) queries[String(i)] = { query: api.collaboration.nativeActivity.getRoomUnreadCounts, args: { workspaceId, conversationIds: ids.slice(i, i + 100) } }
    return queries
  }, [native.channels.rows, native.direct.rows, native.status, workspaceId])
  const roomCounts = useQueries(roomQueries)
  const mark = useMutation(api.collaboration.nativeActivity.markNotificationsRead)
  const markAll = useMutation(api.collaboration.nativeActivity.markAllNotificationsRead)
  const markRoom = useMutation(api.collaboration.nativeActivity.markRoomRead)
  const [entries, setEntries] = useState<ReadAction[]>([])
  const execute = useCallback(async (intent: Intent) => {
    const entry = { ...intent, id: crypto.randomUUID(), at: Date.now() } as ReadAction
    const assertCurrent = () => { if (native.status !== 'ready' || !native.isCurrentScope?.()) throw new Error('Collaboration scope changed') }
    assertCurrent()
    setEntries(current => [...current, entry])
    try {
      if (intent.kind === 'ids') {
        for (let i = 0; i < intent.ids.length; i += 100) {
          assertCurrent()
          await mark({ workspaceId, notificationIds: intent.ids.slice(i, i + 100), observedThrough: intent.through })
        }
      } else if (intent.kind === 'all') {
        let more = true
        while (more) { assertCurrent(); more = (await markAll({ workspaceId, observedThrough: intent.through })).hasMore }
      } else {
        let more = true
        while (more) { assertCurrent(); more = (await markRoom({ workspaceId, conversationId: intent.conversationId as Id<'conversations'>, observedSequence: intent.sequence })).hasMore }
      }
    } finally { setEntries(current => current.filter(row => row.id !== entry.id)) }
  }, [mark, markAll, markRoom, native, workspaceId])
  const value = useMemo<NativeActivity>(() => {
    const canonical = native.status === 'ready' ? page.results.filter(row => row.workspaceId === workspaceId && row.viewerUserId === native.viewerUserId) : []
    const byConversation = Object.assign({}, ...Object.values(roomCounts).map(result => {
      if (result instanceof Error) throw result
      return result?.workspaceId === workspaceId && result.viewerUserId === native.viewerUserId ? result.byConversation : {}
    }))
    const counts = rawCounts?.workspaceId === workspaceId && rawCounts.viewerUserId === native.viewerUserId ? { ...rawCounts, byConversation } : null
    return { status: native.status, notifications: overlayReadItems(canonical, entries), counts: overlayUnreadCounts(counts, canonical, entries),
    ready: native.status === 'ready' && page.status !== 'LoadingFirstPage' && counts !== null,
    hasMore: page.status === 'CanLoadMore', loadingMore: page.status === 'LoadingMore',
    loadMore() { if (page.status === 'CanLoadMore') page.loadMore(100) },
    mark(ids, observedThrough) { return execute({ kind: 'ids', ids, through: observedThrough }) },
    markAll(observedThrough) { return execute({ kind: 'all', through: observedThrough }) },
    markRoom(conversationId, sequence) { return execute({ kind: 'room', conversationId, sequence }) },
    readSequence(conversationId, stored) { return entries.reduce((sequence, entry) => entry.kind === 'room' && entry.conversationId === conversationId ? Math.max(sequence, entry.sequence) : sequence, stored) },
    }
  }, [entries, execute, native.status, native.viewerUserId, page, rawCounts, roomCounts, workspaceId])
  return <NativeActivityContext.Provider value={value}>{children}</NativeActivityContext.Provider>
}

export function NativeActivityProvider({ children }: { children: ReactNode }) {
  const native = useNativeCollaboration()
  return native.status === 'disabled' ? children : <NativeActivityOwner key={native.scopeKey}>{children}</NativeActivityOwner>
}
