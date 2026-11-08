'use client'

import { useMemo } from 'react'
import { usePaginatedQuery, useQuery } from 'convex/react'
import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'
import { usePersonalChatRouteSelection } from './usePersonalChatRouteSelection'
import { projectActivePublicStreams } from '@/shared/chat/public-stream-projection'
import { usePublicStreamMetrics } from './usePublicStreamMetrics'

export {
  canSetPendingTranscript,
  pendingIntentMatches,
  pendingTranscriptInvalid,
  selectedChatIdFromRouteEvent,
} from './usePersonalChatRouteSelection'
export type { PendingTranscript } from './usePersonalChatRouteSelection'

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

export function usePersonalChatTranscript({ workspaceId, canQuery, canRead, pathname, routeId }: {
  workspaceId: string | null
  canQuery: boolean
  canRead: boolean
  pathname: string
  routeId: string | null
}) {
  const {
    selectedConversationId, viewerUserId, conversationId, setPendingTranscriptConversation,
  } = usePersonalChatRouteSelection({ workspaceId, canQuery, canRead, pathname, routeId })
  // A malformed `?id=` would fail the query's id validator and take the chat provider down; treat it as not found.
  const wellFormed = conversationId !== null && isConvexIdShape(conversationId)
  const queriedSummary = useQuery(api.chat.personal.getSummary,
    canQuery && canRead && wellFormed
      ? { workspaceId: workspaceId!, conversationId: conversationId as Id<'conversations'> }
      : 'skip')
  const selectedSummary = canQuery && canRead && conversationId !== null && !wellFormed ? null : queriedSummary
  const summaryInScope = Boolean(selectedSummary && selectedSummary._id === conversationId
    && selectedSummary.workspaceId === workspaceId)
  const canReadMessages = canQuery && canRead && summaryInScope
  const messages = usePaginatedQuery(api.chat.personal.getMessages,
    canReadMessages ? { workspaceId: workspaceId!, conversationId: conversationId as Id<'conversations'> } : 'skip',
    { initialNumItems: 50 })
  const generatingMessageIds = messages.results
    .filter(row => row.message.conversationId === conversationId && row.message.status === 'generating')
    .slice(0, 50).map(row => row.message._id)
  // Only subscribe while something is generating: idle chats never depend on the stream query.
  const activeStreams = useQuery(api.chat.personal.activePublicStreams,
    canReadMessages && generatingMessageIds.length > 0 ? {
      workspaceId: workspaceId!,
      conversationId: conversationId as Id<'conversations'>,
      messageIds: generatingMessageIds,
    } : 'skip')
  usePublicStreamMetrics(activeStreams ?? [])
  const scopedRows = useMemo(
    () => messages.results.filter(row => row.message.conversationId === conversationId),
    [conversationId, messages.results],
  )
  const projectedMessages = useMemo(
    () => projectActivePublicStreams(scopedRows.map(row => row.message), activeStreams ?? []),
    [activeStreams, scopedRows],
  )
  const rows = useMemo(
    () => scopedRows.map((row, index) => ({ ...row, message: projectedMessages[index]! })),
    [projectedMessages, scopedRows],
  )

  return {
    selectedConversationId,
    selectedSummary,
    viewerUserId,
    setPendingTranscriptConversation,
    transcript: {
      conversationId: canReadMessages ? conversationId : null,
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
