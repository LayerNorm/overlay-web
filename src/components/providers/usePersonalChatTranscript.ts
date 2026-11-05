'use client'

import { useCallback, useEffect, useState } from 'react'
import { usePaginatedQuery, useQuery } from 'convex/react'
import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'

type PendingTranscript = {
  conversationId: string
  ownerId: string
  workspaceId: string
  intentKey?: string | null
}

function pendingTranscriptInvalid(pending: PendingTranscript, workspaceId: string | null,
  selectedId: string | null, canRead: boolean, viewer: { userId: string } | null | undefined) {
  return !canRead || pending.workspaceId !== workspaceId || selectedId !== null
    || (viewer !== undefined && viewer?.userId !== pending.ownerId)
}

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
  const routeKey = JSON.stringify([pathname, routeId])
  const [selection, setSelection] = useState({ routeKey, conversationId: routeId })
  if (selection.routeKey !== routeKey) setSelection({ routeKey, conversationId: routeId })
  const selectedConversationId = selection.routeKey === routeKey ? selection.conversationId : routeId
  const [pending, setPending] = useState<PendingTranscript | null>(null)
  const viewer = useQuery(api.auth.viewer.current, canQuery && pending ? {} : 'skip')
  const pendingInvalid = pending && pendingTranscriptInvalid(pending, workspaceId, selectedConversationId, canRead, viewer)
  if (pendingInvalid) setPending(null)
  const pendingId = !pendingInvalid && pending?.ownerId === viewer?.userId ? pending?.conversationId : null
  const conversationId = selectedConversationId ?? pendingId ?? null
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

  useEffect(() => {
    function syncRoute() {
      const id = canRead ? new URLSearchParams(window.location.search).get('id') : null
      setSelection({ routeKey, conversationId: id })
      setPending(null)
    }
    window.addEventListener('overlay:chat-route-selected', syncRoute)
    window.addEventListener('popstate', syncRoute)
    return () => {
      window.removeEventListener('overlay:chat-route-selected', syncRoute)
      window.removeEventListener('popstate', syncRoute)
    }
  }, [canRead, routeKey])

  const setPendingTranscriptConversation = useCallback((
    id: string | null, ownerId?: string | null, intentKey?: string | null,
  ) => {
    if (!id || !ownerId || !workspaceId) {
      setPending(current => !intentKey || current?.intentKey === intentKey ? null : current)
      return
    }
    setPending({ conversationId: id, ownerId, workspaceId, intentKey })
  }, [workspaceId])

  return {
    selectedConversationId,
    selectedSummary,
    setPendingTranscriptConversation,
    transcript: {
      conversationId: canReadMessages ? conversationId : null,
      rows: canReadMessages ? messages.results : [],
      status: transcriptStatus(canRead, canQuery, conversationId, selectedSummary !== undefined,
        summaryInScope, messages.status === 'LoadingFirstPage'),
      queryStatus: messages.status,
      hasMore: canReadMessages && (messages.status === 'CanLoadMore' || messages.status === 'LoadingMore'),
      loadingMore: canReadMessages && messages.status === 'LoadingMore',
      loadMore: () => { if (canReadMessages && messages.status === 'CanLoadMore') messages.loadMore(50) },
    },
  }
}
