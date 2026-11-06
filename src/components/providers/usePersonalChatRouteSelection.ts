'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useQuery } from 'convex/react'
import { api } from '../../../convex/_generated/api'

export type PendingTranscript = {
  conversationId: string
  ownerId: string
  workspaceId: string
  intentKey?: string | null
}

export function pendingTranscriptInvalid(pending: PendingTranscript, workspaceId: string | null,
  selectedId: string | null, canRead: boolean, viewer: { userId: string } | null | undefined) {
  return !canRead || pending.workspaceId !== workspaceId || selectedId !== null
    || (viewer !== undefined && viewer?.userId !== pending.ownerId)
}

export function selectedChatIdFromRouteEvent(
  detail: { chatId?: string | null } | undefined,
  search: string,
  canRead: boolean,
) {
  if (!canRead) return null
  if (detail && Object.prototype.hasOwnProperty.call(detail, 'chatId')) {
    return typeof detail.chatId === 'string' ? detail.chatId : null
  }
  return new URLSearchParams(search).get('id')
}

export function canSetPendingTranscript({
  currentRouteGeneration,
  renderRouteGeneration,
  currentRouteKey,
  renderRouteKey,
  currentWorkspaceId,
  renderWorkspaceId,
  canQuery,
  canRead,
  viewerUserId,
  ownerId,
  selectedConversationId,
}: {
  currentRouteGeneration: number
  renderRouteGeneration: number
  currentRouteKey: string
  renderRouteKey: string
  currentWorkspaceId: string | null
  renderWorkspaceId: string | null
  canQuery: boolean
  canRead: boolean
  viewerUserId: string | null
  ownerId: string
  selectedConversationId: string | null
}) {
  return currentRouteGeneration === renderRouteGeneration
    && currentRouteKey === renderRouteKey
    && currentWorkspaceId === renderWorkspaceId
    && canQuery && canRead
    && viewerUserId === ownerId
    && selectedConversationId === null
}

export function pendingIntentMatches(
  pending: PendingTranscript | null,
  intentKey: string | null | undefined,
  ownerId: string | null | undefined,
  workspaceId: string | null,
) {
  return Boolean(pending && intentKey && pending.intentKey === intentKey
    && pending.ownerId === ownerId && pending.workspaceId === workspaceId)
}

export function usePersonalChatRouteSelection({
  workspaceId, canQuery, canRead, pathname, routeId,
}: {
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
  const viewer = useQuery(api.auth.viewer.current, canQuery && canRead ? {} : 'skip')
  const viewerUserId = viewer?.userId ?? null
  const routeGeneration = useRef(0)
  const scopeRef = useRef({
    workspaceId, routeKey, canQuery, canRead, selectedConversationId, viewerUserId,
  })
  useEffect(() => {
    scopeRef.current = { workspaceId, routeKey, canQuery, canRead, selectedConversationId, viewerUserId }
  }, [workspaceId, routeKey, canQuery, canRead, selectedConversationId, viewerUserId])
  const renderRouteGeneration = routeGeneration.current
  const pendingInvalid = pending && (!canQuery
    || pendingTranscriptInvalid(pending, workspaceId, selectedConversationId, canRead, viewer))
  if (pendingInvalid) setPending(null)
  const pendingId = !pendingInvalid && pending?.ownerId === viewer?.userId ? pending?.conversationId : null
  const conversationId = selectedConversationId ?? pendingId ?? null

  useEffect(() => {
    function syncRoute(event: Event) {
      routeGeneration.current += 1
      const detail = (event as CustomEvent<{ chatId?: string | null }>).detail
      const id = selectedChatIdFromRouteEvent(detail, window.location.search, canRead)
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
    const current = scopeRef.current
    if (!id || !ownerId || !workspaceId) {
      if (intentKey) {
        setPending(pending => pendingIntentMatches(pending, intentKey, ownerId, workspaceId) ? null : pending)
      } else if (routeGeneration.current === renderRouteGeneration
        && current.routeKey === routeKey && current.workspaceId === workspaceId) {
        setPending(null)
      }
      return
    }
    if (!canSetPendingTranscript({
      currentRouteGeneration: routeGeneration.current,
      renderRouteGeneration,
      currentRouteKey: current.routeKey,
      renderRouteKey: routeKey,
      currentWorkspaceId: current.workspaceId,
      renderWorkspaceId: workspaceId,
      canQuery: current.canQuery,
      canRead: current.canRead,
      viewerUserId: current.viewerUserId,
      ownerId,
      selectedConversationId: current.selectedConversationId,
    })) return
    setPending(pending => pending && pending.intentKey !== intentKey ? pending : {
      conversationId: id, ownerId, workspaceId, intentKey,
    })
  }, [renderRouteGeneration, routeKey, workspaceId])

  return { selectedConversationId, viewerUserId, conversationId, setPendingTranscriptConversation }
}
