'use client'

import { Hash, Mail } from 'lucide-react'
import { useEffect, useRef, useState, type ComponentProps } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import ChatExperience from './ChatExperience'
import { ChatSurfaceEmptyState } from './ChatSurfaceEmptyState'
import { DirectMessageExperience } from './DirectMessageExperience'
import { overlayAppClient } from '@/shared/app/overlay-app-client'
import { resolveSoftChatRoute, scopeForConversationDetail, type SoftChatRoute } from '@/shared/chat/chat-view-navigation'
import {
  legacyWorkspaceScopeForRoute,
  normalizeChatViewForScope,
  readWorkspacePathScope,
} from '@/shared/workspaces/routing'
import { useWorkspaceHref } from '@/hooks/use-workspace-href'

/**
 * Soft chat switches use `history.pushState` (see ChatInlinePanel) so the app
 * shell does not remount. Next's `useSearchParams` does not observe that, so
 * DMs/channels re-read `window.location` whenever soft navigation fires.
 */
function readBrowserChatRoute(): SoftChatRoute | null {
  if (typeof window === 'undefined') return null
  const params = new URLSearchParams(window.location.search)
  return {
    conversationId: params.get('id'),
    view: params.get('view'),
  }
}

function CollaborationViewEmptyState({ view }: { view: 'dms' | 'channels' }) {
  const Icon = view === 'dms' ? Mail : Hash
  return (
    <ChatSurfaceEmptyState
      icon={Icon}
      title={view === 'dms' ? 'Select a direct message' : 'Select a channel'}
      description={view === 'dms'
        ? 'Choose a conversation from the sidebar or start a new message.'
        : 'Choose a channel from the sidebar or create a new one.'}
    />
  )
}

export function ConversationExperienceRouter(props: ComponentProps<typeof ChatExperience>) {
  const pathname = usePathname() ?? ''
  const router = useRouter()
  const buildWorkspaceHref = useWorkspaceHref()
  const pathScope = readWorkspacePathScope(pathname)
  const searchParams = useSearchParams()
  const searchConversationId = searchParams?.get('id') ?? null
  const searchView = searchParams?.get('view') ?? null
  const draft = searchParams?.get('draft') === '1'
  const draftTitle = searchParams?.get('title') ?? undefined
  const browserRoute = readBrowserChatRoute()
  const searchRoute = {
    conversationId: searchConversationId,
    view: searchView,
  }
  const browserView = browserRoute?.view ?? null
  const route = browserView === searchView
    ? resolveSoftChatRoute(browserRoute, searchRoute)
    : searchRoute
  const conversationId = route.conversationId
  // Bumped only from browser soft-nav / popstate so we re-read window.location.
  const [browserRouteVersion, setBrowserRouteVersion] = useState(0)
  const [scopeRouteStatus, setScopeRouteStatus] = useState<{
    routeKey: string
    status: 'verified' | 'unavailable'
  } | null>(null)

  useEffect(() => {
    function bumpBrowserRoute() {
      setBrowserRouteVersion((value) => value + 1)
    }
    window.addEventListener('overlay:chat-route-selected', bumpBrowserRoute)
    window.addEventListener('popstate', bumpBrowserRoute)
    return () => {
      window.removeEventListener('overlay:chat-route-selected', bumpBrowserRoute)
      window.removeEventListener('popstate', bumpBrowserRoute)
    }
  }, [])

  const resourceRouteKey = pathScope && conversationId ? `${pathScope}:${conversationId}` : null
  const probedRouteKey = useRef<string | null>(null)
  useEffect(() => {
    if (!resourceRouteKey || props.publicShowcaseSnapshots || draft) return
    if (probedRouteKey.current === resourceRouteKey) return
    probedRouteKey.current = resourceRouteKey
    void (async () => {
      try {
        const id = conversationId
        if (!id || !pathScope) return
        const detail = await overlayAppClient.conversations.get<{
          conversationType?: 'personal' | 'dm' | 'channel'
          scope?: 'personal' | 'workspace'
        }>({ conversationId: id })
        const actualScope = scopeForConversationDetail(detail)
        const actualView = actualScope === 'personal'
          ? 'personal'
          : detail.conversationType === 'dm'
            ? 'dms'
            : detail.conversationType === 'channel'
              ? 'channels'
              : 'workspace-chats'
        const params = new URLSearchParams(window.location.search)
        if (params.get('id') !== id) return
        if (params.get('view') !== actualView) params.set('view', actualView)
        if (actualScope !== pathScope) {
          const route = buildWorkspaceHref(null, `${pathname}?${params.toString()}`, actualScope)
          router.replace(route)
          return
        }
        if (params.get('scope')) {
          router.replace(buildWorkspaceHref(null, `${pathname}?${params.toString()}`, actualScope))
          setScopeRouteStatus({ routeKey: resourceRouteKey, status: 'verified' })
          return
        }
        const current = `${pathname}${window.location.search}`
        const normalized = buildWorkspaceHref(null, `${pathname}?${params.toString()}`, actualScope)
        if (normalized !== current) {
          router.replace(normalized)
          setScopeRouteStatus({ routeKey: resourceRouteKey, status: 'verified' })
          return
        }
        setScopeRouteStatus({ routeKey: resourceRouteKey, status: 'verified' })
      } catch {
        setScopeRouteStatus({ routeKey: resourceRouteKey, status: 'unavailable' })
      }
    })()
  }, [browserRouteVersion, conversationId, searchView, props.publicShowcaseSnapshots, pathScope, resourceRouteKey, buildWorkspaceHref, pathname, router, draft])

  void browserRouteVersion
  const selectedScope = pathScope ?? legacyWorkspaceScopeForRoute(
    'chat',
    new URLSearchParams(searchParams?.toString() ?? ''),
  )
  const view = selectedScope ? normalizeChatViewForScope(selectedScope, route.view) : route.view

  if (resourceRouteKey && scopeRouteStatus?.routeKey === resourceRouteKey && scopeRouteStatus.status === 'unavailable') {
    return (
      <ChatSurfaceEmptyState
        icon={Mail}
        title="Conversation unavailable"
        description="This conversation could not be opened."
      />
    )
  }
  if (resourceRouteKey && scopeRouteStatus?.routeKey !== resourceRouteKey) return null

  if (view === 'dms' && conversationId) {
    return (
      <DirectMessageExperience
        key={`dm:${conversationId}`}
        conversationId={conversationId}
        draft={draft}
        draftTitle={draftTitle}
        showcase={Boolean(props.publicShowcaseSnapshots)}
      />
    )
  }
  if (view === 'channels' && conversationId) {
    return (
      <DirectMessageExperience
        key={`channel:${conversationId}`}
        conversationId={conversationId}
        conversationType="channel"
        draft={draft}
        draftTitle={draftTitle}
        showcase={Boolean(props.publicShowcaseSnapshots)}
      />
    )
  }
  if (view === 'dms' || view === 'channels') {
    return <CollaborationViewEmptyState view={view} />
  }
  return <ChatExperience {...props} />
}
