'use client'

import type { ReactNode } from 'react'
import type { WorkspaceHrefBuilder } from '@/hooks/use-workspace-href'
import { scopeForConversationDetail } from '@/shared/chat/chat-view-navigation'
import { normalizeChatViewForScope, readWorkspacePathScope } from '@/shared/workspaces/routing'
import type { PanelScope } from '@/shared/workspaces/panel-scope'

export type ConversationDetailScopeStatus = {
  routeKey: string
  status: 'verified' | 'unavailable'
}

export type ConversationScopeDetail = {
  conversationType?: 'personal' | 'dm' | 'channel'
  scope?: 'personal' | 'workspace'
}

export type ConversationRouteLocation = {
  pathname: string
  search: string
  hash: string
}

export function conversationDetailRouteKey(args: {
  pathScope: PanelScope | null
  conversationId: string | null

}): string | null {
  if (!args.pathScope || !args.conversationId) return null
  return `${args.pathScope}:${args.conversationId}`
}

export function ConversationDetailScopeGate({
  routeKey,
  status,
  fallback,
  children,
}: {
  routeKey: string | null
  status: ConversationDetailScopeStatus | null
  fallback: ReactNode
  children: ReactNode
}) {
  if (!routeKey) return children
  if (status?.routeKey === routeKey && status.status === 'unavailable') return fallback
  if (status?.routeKey !== routeKey) return null
  return children
}

export function startConversationDetailScopeProbe(args: {
  routeKey: string
  conversationId: string
  pathScope: PanelScope
  pathname: string
  getConversation: (conversationId: string) => Promise<ConversationScopeDetail>
  getLocation: () => ConversationRouteLocation
  buildWorkspaceHref: WorkspaceHrefBuilder
  replace: (destination: string) => void
  setStatus: (status: ConversationDetailScopeStatus) => void
}): () => void {
  const controller = new AbortController()
  const isCurrent = (location: ConversationRouteLocation) => (
    !controller.signal.aborted
    && location.pathname === args.pathname
    && readWorkspacePathScope(location.pathname) === args.pathScope
    && new URLSearchParams(location.search).get('id') === args.conversationId
  )

  void (async () => {
    let detail: ConversationScopeDetail
    try {
      detail = await args.getConversation(args.conversationId)
    } catch {
      const location = args.getLocation()
      if (isCurrent(location)) args.setStatus({ routeKey: args.routeKey, status: 'unavailable' })
      return
    }

    const location = args.getLocation()
    if (!isCurrent(location)) return

    const params = new URLSearchParams(location.search)
    const requestedView = params.get('view')
    const actualScope = scopeForConversationDetail(detail)
    const actualView = normalizeChatViewForScope(
      actualScope,
      detail.conversationType === 'dm'
        ? 'dms'
        : detail.conversationType === 'channel'
          ? 'channels'
          : actualScope === 'workspace' ? 'workspace-chats' : 'personal',
    )
    if (requestedView !== actualView) params.set('view', actualView)

    const source = `${location.pathname}${params.toString() ? `?${params.toString()}` : ''}${location.hash}`
    const current = `${location.pathname}${location.search}${location.hash}`
    const destination = args.buildWorkspaceHref(null, source, actualScope)
    const scopeMismatch = actualScope !== args.pathScope
    const viewMismatch = requestedView !== actualView
    if (destination !== current) args.replace(destination)
    if (scopeMismatch || viewMismatch) return
    args.setStatus({ routeKey: args.routeKey, status: 'verified' })
  })()

  return () => controller.abort()
}
