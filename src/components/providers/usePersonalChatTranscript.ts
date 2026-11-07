'use client'

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
  const selectedSummary = useQuery(api.chat.personal.getSummary,
    canQuery && canRead && conversationId
      ? { workspaceId: workspaceId!, conversationId: conversationId as Id<'conversations'> }
      : 'skip')
  const summaryInScope = Boolean(selectedSummary && selectedSummary._id === conversationId
    && selectedSummary.workspaceId === workspaceId)
  const canReadMessages = canQuery && canRead && summaryInScope
  const messages = usePaginatedQuery(api.chat.personal.getMessages,
    canReadMessages ? { workspaceId: workspaceId!, conversationId: conversationId as Id<'conversations'> } : 'skip',
    { initialNumItems: 50 })
  const activeStreams = useQuery(api.chat.personal.activePublicStreams,
    canReadMessages ? {
      workspaceId: workspaceId!,
      conversationId: conversationId as Id<'conversations'>,
      messageIds: messages.results.slice(0, 50).map(row => row.message._id),
    } : 'skip')
  usePublicStreamMetrics(activeStreams ?? [])
  const projectedMessages = projectActivePublicStreams(messages.results.map(row => row.message), activeStreams ?? [])
  const rows = messages.results.map((row, index) => ({ ...row, message: projectedMessages[index]! }))

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
