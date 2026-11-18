'use client'

import { useEffect, useMemo, useRef } from 'react'
import { usePaginatedQuery, useQuery } from 'convex/react'
import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'
import { projectActivePublicStreams } from '@/shared/chat/public-stream-projection'
import { useLivePublicStreams } from './useLivePublicStreams'
import { restoredPageSize, type TranscriptCacheEntry } from '@/shared/chat/transcript-cache'
import {
  transcriptCache,
  useTranscriptCacheKey,
  type PersonalCachedRow,
  type PersonalCachedSummary,
} from './transcript-cache-client'

function transcriptStatus(canRead: boolean, canQuery: boolean, id: string | null, summaryReady: boolean,
  summaryInScope: boolean, loading: boolean): 'disabled' | 'loading' | 'ready' | 'unavailable' {
  if (!canRead) return 'disabled'
  if (!canQuery) return 'loading'
  if (!id) return 'ready'
  if (!summaryReady) return 'loading'
  if (!summaryInScope) return 'unavailable'
  return loading ? 'loading' : 'ready'
}

/** Whether a route id could be a Convex document id; anything else is treated as not found without a query. */
export function isConvexIdShape(id: string): boolean {
  return /^[0-9a-z]{20,40}$/.test(id)
}

function getMessagesQueryArgs({
  canQuery,
  canRead,
  wellFormed,
  parallelReads,
  summaryInScope,
  workspaceId,
  conversationId,
}: {
  canQuery: boolean
  canRead: boolean
  wellFormed: boolean
  parallelReads: boolean
  summaryInScope: boolean
  workspaceId: string | null
  conversationId: string | null
}) {
  if (!(canQuery && canRead && wellFormed && (parallelReads || summaryInScope))) return 'skip'
  return {
    workspaceId: workspaceId!,
    conversationId: conversationId as Id<'conversations'>,
    ...(parallelReads ? { unavailableAsEmpty: true } : {}),
  }
}

/** Read once per conversation visit: later write-backs must not change the page size mid-visit. */
function useCachedPersonalTranscript(conversationId: string | null, workspaceId: string | null) {
  const cacheKey = useTranscriptCacheKey(conversationId ? { kind: 'personal', conversationId } : null, workspaceId)
  const cached = useMemo(
    () => cacheKey ? transcriptCache.get<PersonalCachedRow, PersonalCachedSummary>(cacheKey) : null,
    [cacheKey],
  )
  return { cacheKey, cached }
}

/**
 * Remembers a conversation's live rows when the reader leaves and, on a revisit,
 * returns the remembered rows until the live summary and first page answer.
 * The snapshot is display-only; a conversation found unavailable is forgotten.
 */
function usePersonalTranscriptMemory({
  cacheKey, cached, conversationId, selectedSummary, summaryInScope, scopedRows, liveSettled, exhausted,
}: {
  cacheKey: string | null
  cached: TranscriptCacheEntry<PersonalCachedRow, PersonalCachedSummary> | null
  conversationId: string | null
  selectedSummary: PersonalCachedSummary | null | undefined
  summaryInScope: boolean
  scopedRows: PersonalCachedRow[]
  liveSettled: boolean
  exhausted: boolean
}) {
  const knownUnavailable = selectedSummary === null || Boolean(selectedSummary && !summaryInScope)
  const cachedRows = useMemo(() => cached?.items.filter(row => row.message.conversationId === conversationId) ?? [],
    [cached, conversationId])
  const snapshotRef = useRef<{ key: string; rows: PersonalCachedRow[]; summary: PersonalCachedSummary; isDone: boolean } | null>(null)
  useEffect(() => {
    if (!cacheKey) return
    if (knownUnavailable) {
      transcriptCache.evict(cacheKey)
      snapshotRef.current = null
      return
    }
    if (!liveSettled || !selectedSummary) return
    snapshotRef.current = { key: cacheKey, rows: scopedRows, summary: selectedSummary, isDone: exhausted }
  }, [cacheKey, exhausted, knownUnavailable, liveSettled, scopedRows, selectedSummary])
  // Write back when the reader leaves, not on every streamed update.
  useEffect(() => () => {
    const snapshot = snapshotRef.current
    snapshotRef.current = null
    if (!snapshot || snapshot.key !== cacheKey) return
    transcriptCache.put(snapshot.key, { items: snapshot.rows, summary: snapshot.summary, isDone: snapshot.isDone, source: 'live' })
  }, [cacheKey])
  if (!cached || liveSettled || knownUnavailable) return null
  return {
    summary: selectedSummary ?? cached.summary,
    transcript: {
      conversationId,
      rows: cachedRows,
      status: 'ready' as const,
      restored: true,
      hasMore: !cached.isDone,
      loadingMore: false,
      loadMore: () => undefined,
    },
  }
}

/**
 * One personal conversation's summary, saved messages and live reply text, for any
 * surface that shows it: the chat route and a note's assistant panel both read here.
 */
export function usePersonalConversationTranscript({ workspaceId, conversationId, canQuery, canRead }: {
  workspaceId: string | null
  conversationId: string | null
  canQuery: boolean
  canRead: boolean
}) {
  // A malformed `?id=` would fail the query's id validator and take the chat provider down; treat it as not found.
  const wellFormed = conversationId !== null && isConvexIdShape(conversationId)
  const readable = canQuery && canRead && wellFormed
  const queriedSummary = useQuery(api.chat.personal.getSummary,
    readable ? { workspaceId: workspaceId!, conversationId: conversationId as Id<'conversations'> } : 'skip')
  const selectedSummary = canQuery && canRead && conversationId !== null && !wellFormed ? null : queriedSummary
  const summaryInScope = Boolean(selectedSummary && selectedSummary._id === conversationId
    && selectedSummary.workspaceId === workspaceId)
  const canReadMessages = canQuery && canRead && summaryInScope
  const settings = useQuery(api.platform.uiSettings.mine, canQuery && canRead ? {} : 'skip')
  const parallelReads = settings?.personalChatParallelReadsRevision === 'parallel-reads-v1'
  const { cacheKey, cached } = useCachedPersonalTranscript(readable ? conversationId : null, workspaceId)
  const messages = usePaginatedQuery(api.chat.personal.getMessages,
    getMessagesQueryArgs({
      canQuery, canRead, wellFormed, parallelReads, summaryInScope, workspaceId, conversationId,
    }),
    { initialNumItems: restoredPageSize(cached, 50) })
  const generatingMessageIds = messages.results
    .filter(row => row.message.conversationId === conversationId && row.message.status === 'generating')
    .slice(0, 50).map(row => row.message._id)
  // Only subscribe while something is generating: idle chats never depend on the stream query.
  const activeStreams = useLivePublicStreams({
    scope: canReadMessages ? { workspaceId: workspaceId!, conversationId: conversationId! } : null,
    messageIds: generatingMessageIds,
    incremental: settings?.livePublicStreamRevision === 'incremental-v1',
    fullQuery: api.chat.personal.activePublicStreams,
    updatesQuery: api.chat.personal.activePublicStreamUpdates,
  })
  const scopedRows = useMemo(
    () => messages.results.filter(row => row.message.conversationId === conversationId),
    [conversationId, messages.results],
  )
  const projectedMessages = useMemo(
    () => projectActivePublicStreams(scopedRows.map(row => row.message), activeStreams),
    [activeStreams, scopedRows],
  )
  const rows = useMemo(
    () => scopedRows.map((row, index) => ({ ...row, message: projectedMessages[index]! })),
    [projectedMessages, scopedRows],
  )
  const restored = usePersonalTranscriptMemory({
    cacheKey, cached, conversationId, selectedSummary, summaryInScope, scopedRows,
    liveSettled: canReadMessages && messages.status !== 'LoadingFirstPage',
    exhausted: messages.status === 'Exhausted',
  })
  if (restored) return { selectedSummary: restored.summary, transcript: { ...restored.transcript, queryStatus: messages.status } }

  return {
    selectedSummary,
    transcript: {
      conversationId: canReadMessages ? conversationId : null,
      restored: false,
      rows: canReadMessages ? rows : [],
      status: transcriptStatus(canRead, canQuery, conversationId, selectedSummary !== undefined,
        summaryInScope, messages.status === 'LoadingFirstPage'),
      queryStatus: messages.status,
      hasMore: canReadMessages && (messages.status === 'CanLoadMore' || messages.status === 'LoadingMore'),
      loadingMore: canReadMessages && messages.status === 'LoadingMore',
      loadMore: () => { if (canReadMessages && messages.status === 'CanLoadMore') messages.loadMore(50) },
    },
  }
}
