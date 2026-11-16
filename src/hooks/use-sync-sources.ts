'use client'

import { useEffect, useMemo, useRef, type RefObject } from 'react'
import { useConvexAuth, useMutation, useQuery } from 'convex/react'
import { makeFunctionReference } from 'convex/server'
import { useWorkspace } from '@/contexts/WorkspaceContext'
import { api } from '../../convex/_generated/api'

export type ChannelSyncSource = { provider: 'slack' | 'teams'; importing: boolean }

export const SYNC_SOURCE_LABEL = { slack: 'Slack', teams: 'Teams' } as const

const NO_SOURCES: ReadonlyMap<string, ChannelSyncSource> = new Map()
const PRIORITY_INTERVAL_MS = 60_000
const prioritizeHistory = makeFunctionReference<'mutation', { workspaceId: string; conversationId: string }, unknown>('sync/history:prioritize')

/** Linked Slack and Teams channels in the active workspace by conversation id, live. Empty while loading. */
export function useChannelSyncSources(): ReadonlyMap<string, ChannelSyncSource> {
  const { activeWorkspaceId, status } = useWorkspace()
  const { isAuthenticated, isLoading } = useConvexAuth()
  const workspaceId = status === 'ready' && isAuthenticated && !isLoading ? activeWorkspaceId : null
  const rows = useQuery(api.sync.ui.channelSources, workspaceId ? { workspaceId } : 'skip')
  return useMemo(
    () => rows ? new Map(rows.map(row => [row.conversationId as string, { provider: row.provider, importing: row.importing }])) : NO_SOURCES,
    [rows],
  )
}

/**
 * Moves a linked channel's history import to the front of the queue when the
 * member reaches the top of what has been imported so far. Failures are
 * ignored: history still finishes on its normal schedule.
 */
export function useSyncHistoryPriority({ conversationId, importing, listRef, hasMoreMessages }: {
  conversationId: string
  importing: boolean
  listRef: RefObject<HTMLElement | null>
  hasMoreMessages: boolean
}) {
  const { activeWorkspaceId } = useWorkspace()
  const prioritize = useMutation(prioritizeHistory)
  const lastRequest = useRef({ conversationId: '', at: 0 })
  useEffect(() => {
    const list = listRef.current
    if (!importing || hasMoreMessages || !list || !activeWorkspaceId) return
    const request = () => {
      const last = lastRequest.current
      if (last.conversationId === conversationId && Date.now() - last.at < PRIORITY_INTERVAL_MS) return
      lastRequest.current = { conversationId, at: Date.now() }
      void prioritize({ workspaceId: activeWorkspaceId, conversationId }).catch(() => undefined)
    }
    const onScroll = () => { if (list.scrollTop <= 48) request() }
    if (list.scrollHeight <= list.clientHeight) request()
    list.addEventListener('scroll', onScroll, { passive: true })
    return () => list.removeEventListener('scroll', onScroll)
  }, [activeWorkspaceId, conversationId, hasMoreMessages, importing, listRef, prioritize])
}
